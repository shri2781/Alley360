import Link from "next/link";
import { getActivePackages } from "../../server/packages";
import { getVenue } from "../../server/venue";
import styles from "./landing.module.css";

function formatHour(hour: number): string {
  const h = hour % 24;
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

const FAQS = [
  {
    q: "Do I need to book in advance?",
    a: "Walk-ins are always welcome, but booking ahead guarantees your lane is ready when you arrive.",
  },
  {
    q: "How is my lane time calculated?",
    a: "It depends on your player count and number of games -- we estimate a fair amount of time and hold your lane for that window, plus a short changeover after.",
  },
  {
    q: "Can I book for a large group?",
    a: "Yes -- larger groups are automatically split across adjacent lanes so everyone plays together.",
  },
  {
    q: "What if I need to cancel?",
    a: "Just give us a call. There's no charge for cancelling ahead of your booked time.",
  },
];

export default async function LandingPage() {
  const venue = await getVenue();
  const packages = await getActivePackages(venue.id);
  const hours = `${formatHour(venue.opensAtHour)} - ${formatHour(venue.closesAtHour)}`;

  return (
    <div>
      <header className={styles.nav}>
        <span className={styles.logo}>{venue.name}</span>

        <ul className={styles.navLinksDesktop}>
          <li>
            <a href="#home">Home</a>
          </li>
          <li>
            <a href="#packages">Packages</a>
          </li>
          <li>
            <a href="#about">About</a>
          </li>
          <li>
            <a href="#faq">FAQ</a>
          </li>
          <li>
            <a href="#contact">Contact</a>
          </li>
        </ul>
        <Link href="/book" className={styles.navCta}>
          Book Now
        </Link>

        <input type="checkbox" id="nav-toggle" className={styles.navToggle} />
        <label htmlFor="nav-toggle" className={styles.navToggleLabel} aria-label="Menu">
          &#9776;
        </label>
        <ul className={styles.navMobileMenu}>
          <li>
            <a href="#home">Home</a>
          </li>
          <li>
            <a href="#packages">Packages</a>
          </li>
          <li>
            <a href="#about">About</a>
          </li>
          <li>
            <a href="#faq">FAQ</a>
          </li>
          <li>
            <a href="#contact">Contact</a>
          </li>
          <li>
            <Link href="/book">Book Now</Link>
          </li>
        </ul>
      </header>

      <section id="home" className={styles.hero}>
        <div className={styles.heroKicker}>Roll &bull; Play &bull; Party</div>
        <h1 className={styles.heroTitle}>
          The Ultimate <span className={styles.heroTitleAccent}>Bowling Experience</span>
        </h1>
        <p className={styles.heroSubtitle}>Good vibes. Great games. Unforgettable moments.</p>
        <Link href="/book" className={styles.heroCta}>
          Book Your Session &rsaquo;
        </Link>
      </section>

      <div className={styles.statsBar}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>4</div>
          <div className={styles.statLabel}>Bowling Lanes</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>&#128106;</div>
          <div className={styles.statLabel}>Family Friendly</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>&#127860;</div>
          <div className={styles.statLabel}>Food &amp; Beverages</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>&#127881;</div>
          <div className={styles.statLabel}>Events &amp; Parties</div>
        </div>
      </div>

      <section id="packages" className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2 className={styles.sectionTitle}>Our Packages</h2>
          <p className={styles.sectionSubtitle}>Choose from our flexible packages for every kind of bowler</p>
        </div>

        <div className={styles.packageGrid}>
          {packages.map((p, i) => {
            const featured = i === 1;
            return (
              <div key={p.id} className={`${styles.packageCard} ${featured ? styles.packageCardFeatured : ""}`}>
                {featured && <span className={styles.packageBadge}>Most Popular</span>}
                <span className={styles.packageName}>{p.name}</span>
                <span className={styles.packageGames}>
                  {p.games} game{p.games === 1 ? "" : "s"}
                </span>
                <div className={styles.packagePrice}>
                  &#8377;{p.pricePerPerson} <span className={styles.packagePriceUnit}>/ person</span>
                </div>
                <Link href="/book" className={styles.packageCta}>
                  Book Now
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      <section id="about" className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2 className={styles.sectionTitle}>More Than Bowling</h2>
          <p className={styles.sectionSubtitle}>
            Enjoy a complete entertainment experience with food, drinks, and great company
          </p>
        </div>

        <div className={styles.amenitiesGrid}>
          <div className={styles.amenityCard}>
            <div className={styles.amenityIcon}>&#127860;</div>
            <div className={styles.amenityLabel}>Food &amp; Drinks</div>
          </div>
          <div className={styles.amenityCard}>
            <div className={styles.amenityIcon}>&#127882;</div>
            <div className={styles.amenityLabel}>Party Packages</div>
          </div>
          <div className={styles.amenityCard}>
            <div className={styles.amenityIcon}>&#127942;</div>
            <div className={styles.amenityLabel}>Corporate Events</div>
          </div>
          <div className={styles.amenityCard}>
            <div className={styles.amenityIcon}>&#127775;</div>
            <div className={styles.amenityLabel}>Great Vibes</div>
          </div>
        </div>
      </section>

      <section id="faq" className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2 className={styles.sectionTitle}>Frequently Asked Questions</h2>
        </div>

        <div className={styles.faqList}>
          {FAQS.map((f) => (
            <div key={f.q} className={styles.faqItem}>
              <p className={styles.faqQuestion}>{f.q}</p>
              <p className={styles.faqAnswer}>{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      <footer id="contact" className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerInfo}>
            <span>{venue.name}</span>
            <span>Open Daily &middot; {hours}</span>
          </div>
          <Link href="/book" className={styles.footerCta}>
            Book Your Lane &rsaquo;
          </Link>
        </div>
      </footer>
    </div>
  );
}
