import Image, { type StaticImageData } from "next/image";
import styles from "./PhotoCard.module.css";

/** A photo with a bottom scrim and optional caption, used anywhere a stock photo
 *  needs to sit behind readable text -- gallery tiles, how-it-works steps, package
 *  card backdrops. Defined once so that treatment stays consistent across sections. */
export function PhotoCard({
  src,
  alt,
  caption,
  aspect = "4 / 5",
  fillParent = false,
  sizes = "(min-width: 1024px) 380px, (min-width: 640px) 45vw, 90vw",
  priority = false,
  className,
}: {
  src: StaticImageData;
  alt: string;
  caption?: string;
  /** Ignored when fillParent is true. */
  aspect?: string;
  /** For a hero-style photo that should stretch to cover an ancestor with its own
   *  height (e.g. a full-viewport hero section) instead of sizing itself. */
  fillParent?: boolean;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <figure
      className={`${styles.card} ${fillParent ? styles.fillParent : ""} ${className ?? ""}`}
      style={fillParent ? undefined : { aspectRatio: aspect }}
    >
      <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className={styles.img} />
      {caption && (
        <figcaption className={styles.caption}>
          <span>{caption}</span>
        </figcaption>
      )}
    </figure>
  );
}
