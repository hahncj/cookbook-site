// Serving adjustment and cooking mode (M6, workflow 11). Everything here is a
// temporary view in the browser: the saved recipe never changes (AC-054).
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Ingredient } from "../../server/core/recipes";
import {
  isServingsYield,
  MAX_SERVINGS,
  MULTIPLIERS,
  multiplierLabel,
  parseYield,
  scaleQuantity,
  type ScaledQuantity,
} from "../../server/core/scaling";
import { CloseIcon, FlameIcon, MinusIcon, PlusIcon } from "./icons";
import { useMarkerFetcher, type MarkersView } from "./markers";

const FLAG_TEXT = {
  no_amount: "No amount given — adjust by eye",
  not_a_number: "Not scaled — adjust by eye",
  several_numbers: "Not scaled — check this amount yourself",
} as const;

function useScale(yieldText: string | null) {
  const parsed = parseYield(yieldText);
  const base = parsed.kind === "count" ? parsed.count : null;
  const [servings, setServings] = useState(base ?? 1);
  const [multiplier, setMultiplier] = useState(1);
  const factor = base ? servings / base : multiplier;
  return {
    yieldKind: parsed.kind,
    base,
    servings,
    setServings: (n: number) => setServings(Math.min(MAX_SERVINGS, Math.max(1, n))),
    multiplier,
    setMultiplier,
    factor,
    reset: () => {
      setServings(base ?? 1);
      setMultiplier(1);
    },
  };
}

type Scale = ReturnType<typeof useScale>;

function ScalePanel({ scale, yieldText }: { scale: Scale; yieldText: string | null }) {
  const labelId = useId();
  if (scale.base) {
    const title = isServingsYield(yieldText) ? "Servings" : "Makes";
    return (
      <div className="scale-panel" role="group" aria-labelledby={labelId}>
        <div className="scale-label">
          <span id={labelId} className="scale-title">
            {title}
          </span>
          <span className="muted">Recipe: {yieldText}</span>
        </div>
        <div className="stepper">
          <button
            type="button"
            className="btn-round"
            aria-label={title === "Servings" ? "Fewer servings" : "Less"}
            onClick={() => scale.setServings(scale.servings - 1)}
            disabled={scale.servings <= 1}
          >
            <MinusIcon />
          </button>
          <output aria-live="polite" aria-label={title}>
            {scale.servings}
          </output>
          <button
            type="button"
            className="btn-round"
            aria-label={title === "Servings" ? "More servings" : "More"}
            onClick={() => scale.setServings(scale.servings + 1)}
            disabled={scale.servings >= MAX_SERVINGS}
          >
            <PlusIcon />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="scale-panel scale-panel-multi" role="group" aria-labelledby={labelId}>
      <div className="scale-label">
        <span id={labelId} className="scale-title">
          Scale
        </span>
        <span className="muted">
          {scale.yieldKind === "none"
            ? "This recipe doesn't say how many it serves, so scale it by a multiple."
            : `“${yieldText}” isn't a single number, so scale it by a multiple.`}
        </span>
      </div>
      <div className="multipliers">
        {MULTIPLIERS.map((m) => (
          <button key={m} type="button" className="chip" aria-pressed={scale.multiplier === m} onClick={() => scale.setMultiplier(m)}>
            {multiplierLabel(m)}
          </button>
        ))}
      </div>
    </div>
  );
}

function scaledRows(ingredients: Ingredient[], factor: number): { row: Ingredient; scaled: ScaledQuantity }[] {
  return ingredients.map((row) => ({ row, scaled: scaleQuantity(row.quantity, factor) }));
}

function IngredientList({ ingredients, factor, checkable }: { ingredients: Ingredient[]; factor: number; checkable?: boolean }) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const scaling = factor !== 1;
  return (
    <ul className={checkable ? "ingredients ingredients-check" : "ingredients"}>
      {scaledRows(ingredients, factor).map(({ row, scaled }, index) => {
        const changed = scaled.scalable && scaled.changed;
        const flag = scaling && !scaled.scalable ? FLAG_TEXT[scaled.reason] : null;
        const qty = scaled.text.trim() ? <span className={changed ? "qty qty-scaled" : "qty"}>{scaled.text}</span> : <span className="qty muted">—</span>;
        const body = (
          <span>
            {row.item}
            {flag && <em className="unscaled-note">{flag}</em>}
          </span>
        );
        if (!checkable) {
          return (
            <li key={index} data-scaled={changed || undefined} data-unscaled={flag ? true : undefined}>
              {qty}
              {body}
            </li>
          );
        }
        const done = checked.has(index);
        return (
          <li key={index} data-done={done || undefined} data-unscaled={flag ? true : undefined}>
            <label>
              <input
                type="checkbox"
                checked={done}
                onChange={() => {
                  const next = new Set(checked);
                  if (done) next.delete(index);
                  else next.add(index);
                  setChecked(next);
                }}
              />
              {qty}
              {body}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function ScaledHeading({ id, factor, onReset }: { id: string; factor: number; onReset: () => void }) {
  return (
    <div className="section-head">
      <h2 id={id} className="section-title">
        Ingredients
      </h2>
      {factor !== 1 && (
        <span className="scaled-badge">
          Scaled {multiplierLabel(Number(factor.toFixed(3)))}
          <button type="button" className="link-button" onClick={onReset}>
            Reset
          </button>
        </span>
      )}
    </div>
  );
}

function ScaleNote({ factor }: { factor: number }) {
  if (factor === 1) return null;
  return (
    <p className="scale-note">
      Only the ingredient list is scaled. Cooking times, temperatures, pan sizes and any amounts in the steps stay as written — check
      them yourself. The saved recipe isn't changed.
    </p>
  );
}

// ---------- Screen Wake Lock (AC-055) ----------

type WakeState = "off" | "on" | "unsupported" | "denied" | "lost";

interface Sentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

function wakeLockApi(): { request(type: "screen"): Promise<Sentinel> } | null {
  if (typeof navigator === "undefined") return null;
  const api = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<Sentinel> } }).wakeLock;
  return api && typeof api.request === "function" ? api : null;
}

function useWakeLock() {
  const [state, setState] = useState<WakeState>("off");
  const sentinel = useRef<Sentinel | null>(null);
  const wanted = useRef(false);

  const acquire = useCallback(async () => {
    const api = wakeLockApi();
    if (!api) {
      setState("unsupported");
      return;
    }
    try {
      const lock = await api.request("screen");
      if (!wanted.current) {
        await lock.release();
        return;
      }
      sentinel.current = lock;
      setState("on");
      lock.addEventListener("release", () => {
        sentinel.current = null;
        // The browser drops the lock when the page is hidden; we ask again when it's back.
        if (wanted.current) setState("lost");
      });
    } catch {
      setState("denied");
    }
  }, []);

  const start = useCallback(() => {
    wanted.current = true;
    void acquire();
  }, [acquire]);

  const stop = useCallback(() => {
    wanted.current = false;
    const lock = sentinel.current;
    sentinel.current = null;
    if (lock && !lock.released) void lock.release().catch(() => undefined);
    setState("off");
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && wanted.current && !sentinel.current) void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      wanted.current = false;
      sentinel.current?.release().catch(() => undefined);
    };
  }, [acquire]);

  return { state, start, stop, retry: acquire };
}

function WakeStatus({ state, retry }: { state: WakeState; retry: () => void }) {
  if (state === "on") {
    return (
      <p className="wake-status wake-on" role="status">
        The screen will stay on while cooking mode is open.
      </p>
    );
  }
  if (state === "unsupported") {
    return (
      <p className="wake-status wake-off" role="status">
        This browser can't keep the screen on, so it may dim or lock as usual. To stop that while you cook, set Auto-Lock to a longer time
        (on iPhone: Settings › Display &amp; Brightness › Auto-Lock), or tap the screen now and then.
      </p>
    );
  }
  if (state === "denied" || state === "lost") {
    return (
      <div className="wake-status wake-off" role="status">
        <p>
          {state === "denied"
            ? "The screen couldn't be kept on. Low Power Mode or a browser setting can block it, so it may dim or lock as usual."
            : "The screen may dim again after switching apps."}
        </p>
        <button type="button" className="btn btn-small" onClick={retry}>
          Keep screen on
        </button>
      </div>
    );
  }
  return null;
}

// ---------- The recipe's cooking section ----------

export function CookingSection({
  title,
  yieldText,
  ingredients,
  steps,
  isAdmin,
  markers,
}: {
  title: string;
  yieldText: string | null;
  ingredients: Ingredient[];
  steps: string[];
  isAdmin: boolean;
  markers: MarkersView;
}) {
  const scale = useScale(yieldText);
  const [cooking, setCooking] = useState(false);
  const wake = useWakeLock();
  const hasIngredients = ingredients.length > 0;

  const open = () => {
    // Asked for inside the tap, which some browsers require.
    wake.start();
    setCooking(true);
  };
  const close = () => {
    wake.stop();
    setCooking(false);
  };

  return (
    <>
      {(hasIngredients || steps.length > 0) && (
        <div className="cook-start">
          <button type="button" className="btn btn-primary btn-block" onClick={open}>
            <FlameIcon />
            Start cooking mode
          </button>
        </div>
      )}

      {hasIngredients && <ScalePanel scale={scale} yieldText={yieldText} />}

      {hasIngredients && (
        <section aria-labelledby="ingredients-heading">
          <ScaledHeading id="ingredients-heading" factor={scale.factor} onReset={scale.reset} />
          <IngredientList ingredients={ingredients} factor={scale.factor} />
          <ScaleNote factor={scale.factor} />
        </section>
      )}

      {steps.length > 0 && (
        <section aria-labelledby="method-heading">
          <h2 id="method-heading" className="section-title">
            Method
          </h2>
          <ol className="steps">
            {steps.map((step, index) => (
              <li key={index}>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {cooking && (
        <CookingMode
          title={title}
          yieldText={yieldText}
          ingredients={ingredients}
          steps={steps}
          scale={scale}
          wake={wake}
          onClose={close}
          isAdmin={isAdmin}
          markers={markers}
        />
      )}
    </>
  );
}

function CookingMode({
  title,
  yieldText,
  ingredients,
  steps,
  scale,
  wake,
  onClose,
  isAdmin,
  markers,
}: {
  title: string;
  yieldText: string | null;
  ingredients: Ingredient[];
  steps: string[];
  scale: Scale;
  wake: ReturnType<typeof useWakeLock>;
  onClose: () => void;
  isAdmin: boolean;
  markers: MarkersView;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [done, setDone] = useState<Set<number>>(new Set());

  // On open: focus the title, stop the page behind from scrolling, close on Escape.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, []);

  return (
    <div className="cooking-mode" role="dialog" aria-modal="true" aria-labelledby="cooking-title">
      <div className="cooking-bar">
        <span className="kicker">Cooking mode</span>
        <button type="button" className="btn" onClick={onClose}>
          <CloseIcon />
          Done
        </button>
      </div>
      <div className="cooking-body">
        <h2 id="cooking-title" ref={headingRef} tabIndex={-1} className="cooking-title">
          {title}
        </h2>
        <WakeStatus state={wake.state} retry={wake.retry} />

        {ingredients.length > 0 && (
          <>
            <ScalePanel scale={scale} yieldText={yieldText} />
            <section aria-labelledby="cooking-ingredients">
              <ScaledHeading id="cooking-ingredients" factor={scale.factor} onReset={scale.reset} />
              <IngredientList ingredients={ingredients} factor={scale.factor} checkable />
              <ScaleNote factor={scale.factor} />
            </section>
          </>
        )}

        {steps.length > 0 && (
          <section aria-labelledby="cooking-method">
            <h2 id="cooking-method" className="section-title">
              Method
            </h2>
            <p className="muted cooking-hint">Tap a step when it's done.</p>
            <ol className="steps cooking-steps">
              {steps.map((step, index) => (
                <li key={index}>
                  <button
                    type="button"
                    className="step-toggle"
                    aria-pressed={done.has(index)}
                    onClick={() => {
                      const next = new Set(done);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      setDone(next);
                    }}
                  >
                    <span className="visually-hidden">Step {index + 1}: </span>
                    {step}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}

        {isAdmin && <MarkMade saved={markers} />}
      </div>
    </div>
  );
}

function MarkMade({ saved }: { saved: MarkersView }) {
  const { view, send } = useMarkerFetcher(saved);
  const [marked, setMarked] = useState(false);
  return (
    <div className="cooking-made">
      {marked ? (
        <p role="status" className="muted">
          Marked as made today{view.madeCount > 1 ? ` (${view.madeCount} times so far)` : ""}.
        </p>
      ) : (
        <button
          type="button"
          className="btn btn-block"
          onClick={() => {
            setMarked(true);
            send("made_add");
          }}
        >
          Mark as made today
        </button>
      )}
    </div>
  );
}
