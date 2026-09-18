import type { Metadata } from "next";
import Image from "next/image";

import { imageUrl } from "@/lib/site/images";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { BookingCta } from "../booking-cta";
import { PageHeading } from "../page-heading";

/**
 * The gallery.
 *
 * The first page to read `gallery_images`, and the first to depend on
 * Supabase Storage. The table holds the ordering, the alt text and the
 * captions; the files themselves live in the `site-images` bucket, and
 * `imageUrl()` is the only thing that knows how to turn one into the other.
 *
 * The empty state matters more here than on any other page, because it is how
 * this page will actually launch — the salon has not sent photographs yet.
 * An empty grid says the salon is neglected. A link to the Instagram account
 * they genuinely keep up to date says the opposite, and stops being rendered
 * the moment the first row is inserted.
 */

export const metadata: Metadata = {
  title: "Gallery",
  description: "A look inside the salon.",
};

export default async function GalleryPage() {
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("gallery_images")
    .select("id, storage_path, alt_text, caption")
    .eq("org_id", org.id)
    .order("display_order");

  const images = data ?? [];
  const instagram = org.content.social.instagram;

  return (
    <>
      <PageHeading
        eyebrow="Gallery"
        title="A look inside the salon"
        intro="Photographs of work done in this chair, by these hands."
      />

      {error || images.length === 0 ? (
        <div className="border-b border-line bg-surface-sunk/50 shell py-14 text-center">
          <p className="mx-auto max-w-md text-ink-muted text-pretty">
            We are putting our photographs together. In the meantime, our most
            recent work is on Instagram.
          </p>

          {instagram && (
            <a
              href={instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="label btn mt-6 bg-brand text-ink-inverse hover:bg-brand-strong"
            >
              See our work on Instagram &rarr;
            </a>
          )}
        </div>
      ) : (
        /*
         * A masonry-style column layout rather than a grid of equal boxes.
         * Salon photographs arrive in whatever shape the phone took them, and
         * a grid would crop the top off a tall one. Columns let each image
         * keep its own proportions.
         */
        <ul className="shell gap-4 py-10 sm:columns-2 lg:columns-3">
          {images.map((image) => {
            const url = imageUrl(image.storage_path);
            if (!url) return null;

            return (
              <li key={image.id} className="mb-4 break-inside-avoid">
                <figure>
                  <Image
                    src={url}
                    alt={image.alt_text}
                    width={800}
                    height={1000}
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="h-auto w-full bg-surface-sunk"
                  />

                  {image.caption && (
                    <figcaption className="label mt-2 text-ink-muted">
                      {image.caption}
                    </figcaption>
                  )}
                </figure>
              </li>
            );
          })}
        </ul>
      )}

      <BookingCta phone={org.phone} />
    </>
  );
}
