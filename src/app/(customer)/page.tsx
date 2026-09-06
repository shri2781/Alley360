import Link from "next/link";
import { DEFAULT_ESTIMATOR_CONFIG } from "../../domain/config";
import { getActivePackages } from "../../server/packages";
import { getActiveLaneCount } from "../../server/lanes";
import { getVenue } from "../../server/venue";
import { PhotoCard } from "./_components/PhotoCard";
import { Reveal } from "./_components/Reveal";
import btn from "./_components/Button.module.css";
import { formatHour } from "./format";
import styles from "./landing.module.css";

import heroPhoto from "../../assets/photos/hero-alley.jpg";
import laneDarkPhoto from "../../assets/photos/lane-dark.jpg";
import pinsClosePhoto from "../../assets/photos/pins-closeup.jpg";
import ballReturnPhoto from "../../assets/photos/ball-return.jpg";
import shoesFloorPhoto from "../../assets/photos/shoes-floor.jpg";
import friendsChattingPhoto from "../../assets/photos/friends-chatting.jpg";
import shoesTyingPhoto from "../../assets/photos/shoes-tying.jpg";
import manBallPhoto from "../../assets/photos/man-ball.jpg";
import pinsDownLanePhoto from "../../assets/photos/pins-down-lane.jpg";
import friendsHappyPhoto from "../../assets/photos/friends-happy.jpg";
import friendsFourPhoto from "../../assets/photos/friends-four.jpg";
import friendsPlayingPhoto from "../../assets/photos/friends-playing.jpg";
import alleyMoodyPhoto from "../../assets/photos/alley-moody.jpg";
import ballMotionPhoto from "../../assets/photos/ball-motion.jpg";

const FAQS = [
  {
    q: "Do I need to book in advance?",
    a: "Walk-ins are always welcome, but booking ahead guarantees your lane is ready when you arrive.",
  },
  {
    q: "How is my lane time calculated?",
    a: "It depends on your player count and number of games, we estimate a fair amount of time and hold your lane for that window, plus a short changeover after.",
  },
  {
    q: "Can I book for a large group?",
    a: "Yes, larger groups are automatically split across adjacent lanes so everyone plays together.",
  },
  {
    q: "What if I need to cancel?",
    a: "Just give us a call. There's no charge for cancelling ahead of your booked time.",
  },
  {
    q: "Do I pick my own lane?",
    a: "No need, a lane is assigned automatically the moment you book, based on what's actually free.",
  },
  {
    q: "How do I pay?",
    a: "Pay at the venue when you arrive. No payment is taken online.",
  },
];

const GALLERY = [
  { src: friendsHappyPhoto, alt: "A group of friends laughing together at the alley" },
  { src: friendsFourPhoto, alt: "Four friends posing with bowling balls" },
  { src: friendsPlayingPhoto, alt: "Friends playing a game of bowling" },
  { src: ballMotionPhoto, alt: "A bowling ball in motion under neon lights" },
  { src: alleyMoodyPhoto, alt: "Dimly lit bowling alley with vivid lane lighting" },
];

export default async function LandingPage() {
  const venue = await getVenue();
  const [packages, laneCount] = await Promise.all([
    getActivePackages(venue.id),
    getActiveLaneCount(venue.id),
  ]);
  const hours = `${formatHour(venue.opensAtHour)} – ${formatHour(venue.closesAtHour)}`;

  const stats = [
    { photo: laneDarkPhoto, value: String(laneCount), label: laneCount === 1 ? "Bowling Lane" : "Bowling Lanes" },
    { photo: pinsClosePhoto, value: `Up to ${DEFAULT_ESTIMATOR_CONFIG.maxPlayersPerLane}`, label: "Players per Lane" },
    { photo: ballReturnPhoto, value: String(packages.length), label: packages.length === 1 ? "Package" : "Packages" },
    { photo: shoesFloorPhoto, value: hours, label: "Open Daily" },
  ];

  return (
    <div>
      <section id="home" className={styles.hero}>
        <PhotoCard
          src={heroPhoto}
          alt="Wide view of a bowling lane and pins under vivid neon lighting"
          fillParent
          sizes="100vw"
          priority
          className={styles.heroPhoto}
        />
        <div className={styles.heroScrim} />
        <div className={styles.heroContent}>
          <span className={styles.heroPill}>Open today · {hours}</span>
          <div className={styles.heroKicker}>Roll &bull; Play &bull; Party</div>
          <h1 className={styles.heroTitle}>
            The Ultimate <span className={styles.heroTitleAccent}>Bowling Experience</span>
          </h1>
          <p className={styles.heroSubtitle}>Good vibes. Great games. Unforgettable moments.</p>
          <div className={styles.heroActions}>
            <Link href="/book" className={btn.btnPrimary}>
              Book a Lane
            </Link>
            <a href="#packages" className={btn.btnGhost}>
              See Packages
            </a>
          </div>
        </div>
      </section>

      <Reveal as="section" className={styles.statsBar}>
        {stats.map((s) => (
          <div key={s.label} className={styles.statCard}>
            <PhotoCard src={s.photo} alt="" aspect="1 / 1" sizes="120px" className={styles.statPhoto} />
            <div className={styles.statBody}>
              <div className={styles.statValue}>{s.value}</div>
              <div className={styles.statLabel}>{s.label}</div>
            </div>
          </div>
        ))}
      </Reveal>

      <section id="packages" className={styles.section}>
        <Reveal>
          <div className={styles.sectionHeading}>
            <h2 className={styles.sectionTitle}>Our Packages</h2>
            <p className={styles.sectionSubtitle}>Choose from our flexible packages for every kind of bowler</p>
          </div>
        </Reveal>

        <div className={styles.packageGrid}>
          {packages.map((p, i) => {
            const featured = packages.length > 2 && i === Math.floor(packages.length / 2);
            return (
              <Reveal key={p.id} delayMs={i * 60}>
                <div className={`${styles.packageCard} ${featured ? styles.packageCardFeatured : ""}`}>
                  {featured && <span className={styles.packageBadge}>Most Popular</span>}
                  <span className={styles.packageName}>{p.name}</span>
                  <span className={styles.packageGames}>
                    {p.games} game{p.games === 1 ? "" : "s"}
                  </span>
                  <div className={styles.packagePrice}>
                    &#8377;{p.pricePerPerson} <span className={styles.packagePriceUnit}>/ person</span>
                  </div>
                  <Link href="/book" className={`${btn.btnPrimary} ${btn.btnBlock}`}>
                    Book Now
                  </Link>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      <section id="how-it-works" className={styles.section}>
        <Reveal>
          <div className={styles.sectionHeading}>
            <h2 className={styles.sectionTitle}>How It Works</h2>
            <p className={styles.sectionSubtitle}>Three steps, and your lane is waiting</p>
          </div>
        </Reveal>

        <div className={styles.stepsGrid}>
          {[
            { photo: shoesTyingPhoto, alt: "A person lacing up their bowling shoes", title: "Pick players & package", body: "Tell us how many are playing and choose a package, we'll work out how much lane time you need." },
            { photo: manBallPhoto, alt: "A man holding a red bowling ball, ready to play", title: "Choose a real time", body: "We search live availability and show you up to five times that are actually free, no guessing, no double-booking." },
            { photo: pinsDownLanePhoto, alt: "View down a lane toward a full rack of pins", title: "Show up & play", body: "Your lane is assigned automatically. Arrive a few minutes early for shoes and you're set." },
          ].map((step, i) => (
            <Reveal key={step.title} delayMs={i * 80}>
              <div className={styles.stepCard}>
                <PhotoCard src={step.photo} alt={step.alt} aspect="4 / 3" />
                <span className={styles.stepNumber}>{i + 1}</span>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepBody}>{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="about" className={styles.section}>
        <Reveal>
          <div className={styles.sectionHeading}>
            <h2 className={styles.sectionTitle}>Why Bowl Here</h2>
            <p className={styles.sectionSubtitle}>Built around getting you playing, not waiting</p>
          </div>
        </Reveal>

        <div className={styles.amenitiesGrid}>
          {[
            { icon: "⚡", label: "Instant lane assignment" },
            { icon: "👥", label: "Big groups split across adjacent lanes" },
            { icon: "⏱️", label: "Minimal customer wait time" },
            { icon: "🚶", label: "Walk-ins always welcome" },
          ].map((a) => (
            <Reveal key={a.label}>
              <div className={styles.amenityCard}>
                <div className={styles.amenityIcon} aria-hidden="true">
                  {a.icon}
                </div>
                <div className={styles.amenityLabel}>{a.label}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <Reveal as="section" className={styles.gallerySection} aria-label="Photos from the alley">
        <div className={styles.galleryTrack}>
          {[...GALLERY, ...GALLERY].map((g, i) => (
            <PhotoCard key={i} src={g.src} alt={g.alt} aspect="3 / 4" className={styles.galleryTile} sizes="280px" />
          ))}
        </div>
      </Reveal>

      <section id="faq" className={styles.section}>
        <Reveal>
          <div className={styles.sectionHeading}>
            <h2 className={styles.sectionTitle}>Frequently Asked Questions</h2>
          </div>
        </Reveal>

        <Reveal className={styles.faqList}>
          {FAQS.map((f) => (
            <details key={f.q} className={styles.faqItem}>
              <summary className={styles.faqQuestion}>{f.q}</summary>
              <p className={styles.faqAnswer}>{f.a}</p>
            </details>
          ))}
        </Reveal>
      </section>
    </div>
  );
}
