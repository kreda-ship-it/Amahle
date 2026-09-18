/**
 * The top of every page that is not the homepage.
 *
 * One component rather than the same six lines written five times, because
 * the thing that makes a site look designed rather than assembled is that the
 * top of each page is identical to the top of every other page. Written out
 * by hand in five files, they drift within a month.
 *
 * The eyebrow — the small letterspaced line above the title — tells you where
 * you have landed before you have read anything. On paper it is called a
 * kicker and it has been doing this job in newspapers for a century.
 */
export function PageHeading({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
}) {
  return (
    /*
     * The rule runs edge to edge while the words stay on the site's margin.
     * Putting the border on the `shell` itself would stop the line short at
     * the content's own width, which reads as a mistake rather than a choice.
     */
    <header className="border-b border-line">
      <div className="shell py-16 lg:py-24">
        <p className="label text-brand">{eyebrow}</p>

        <h1 className="mt-4 font-display text-5xl leading-[1.06] font-light text-balance sm:text-6xl lg:text-7xl xl:text-8xl">
          {title}
        </h1>

        {intro && (
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted text-pretty">
            {intro}
          </p>
        )}
      </div>
    </header>
  );
}
