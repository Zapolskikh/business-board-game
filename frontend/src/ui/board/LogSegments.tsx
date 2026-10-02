import type { LogSegment } from "../../online/gameUi";
import { ResourceText } from "../primitives/ResourceIcon";

/* Одна строка хроники: имена игроков их цветом, числа — тоном выгоды. Общая для хроники и окна
 * результата серой операции, чтобы одно событие везде читалось одинаково. */
export function LogSegments({ segments }: { segments: LogSegment[] }) {
  return (
    <>
      {segments.map((segment, position) => {
        if (segment.kind === "player") {
          return (
            <b key={position} style={{ color: segment.color }} className="font-semibold">
              <ResourceText>{segment.text}</ResourceText>
            </b>
          );
        }
        if (segment.kind === "num") {
          return (
            <b
              key={position}
              className={
                segment.tone === "good"
                  ? "font-semibold text-good"
                  : segment.tone === "bad"
                    ? "font-semibold text-bad"
                    : "font-semibold text-ink"
              }
            >
              <ResourceText>{segment.text}</ResourceText>
            </b>
          );
        }
        return <span key={position}><ResourceText>{segment.text}</ResourceText></span>;
      })}
    </>
  );
}
