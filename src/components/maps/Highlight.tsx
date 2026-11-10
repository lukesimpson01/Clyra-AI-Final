/** Words found by a search, in blue: the matched part of a result stays readable, the rest stays quiet. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = Array.from(new Set(query.toLowerCase().split(/\s+/).filter(Boolean))).sort((a, b) => b.length - a.length);
  if (!terms.length || !text) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(pattern).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} style={{ color: "#0066ff", fontWeight: 600 }}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
