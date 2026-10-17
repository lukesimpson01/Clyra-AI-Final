import "./cowork.css";

/**
 * The AI-control state indicator (spec: "the viewport gains the restrained
 * blue AI-control edge"). It is a functional signal, not decoration: it is
 * only ever rendered active while Clyra is genuinely driving the wrapped
 * panel, and disappears the instant control returns to the user. Uses the
 * aurora/pixel-dissolve keyframes already defined in
 * src/shared/clyra/clyra-motion.css rather than a new motion language.
 */
export function ClyraControlEdge({ active, label }: { active: boolean; label?: string }) {
  return (
    <div className={`cowork-control-edge${active ? " cowork-control-edge--active" : ""}`} aria-hidden={!active}>
      <div className="cowork-control-edge__ring" />
      <div className="cowork-control-edge__grain" />
      {active && label ? (
        <div className="cowork-control-edge__label">
          <span className="cowork-control-edge__label-dot" />
          {label}
        </div>
      ) : null}
    </div>
  );
}
