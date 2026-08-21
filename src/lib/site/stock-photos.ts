/**
 * TEMPORARY stand-in photographs.
 *
 * The salon has not uploaded its own pictures yet. Every page still reads the
 * database first — `imageUrl(org.content.heroImagePath)`, an employee's
 * `photo_path`, the `gallery_images` table — and only reaches for one of these
 * when the answer is null. So the day a real photograph is uploaded it simply
 * replaces the stand-in, with no page edited.
 *
 * Why this file exists at all: a layout made of grey rectangles cannot be
 * judged. You cannot tell whether the price list reads well, or whether the
 * hero is the right shape, until there are real photographs sitting in it.
 *
 * WHAT IT IS NOT: content. Nothing here is about Kedus. These are generic
 * salon and braiding photographs keyed by the SLOT they fill — a hero, a
 * service thumbnail, a gallery tile — which is why the file is allowed to
 * exist alongside the rule that no page knows which salon it is serving.
 *
 * DELETE THIS FILE when the salon's own photographs are in Supabase Storage,
 * and remove the `images.unsplash.com` entry from next.config.ts at the same
 * time. Anything still importing it will fail to compile, which is exactly the
 * reminder you want.
 *
 * One deliberate omission: there are no portraits here. A stock photograph of
 * a stranger printed under a real employee's name is a lie about a real
 * person, and no layout preview is worth that. Staff without a photograph get
 * their initials, the same as before.
 */

export type StockPhoto = {
  url: string;
  alt: string;
};

/**
 * Unsplash serves a resized copy if you ask for one, so we ask. Without this
 * every thumbnail on the page downloads a photograph several thousand pixels
 * wide before Next.js shrinks it.
 */
function sized(id: string, width: number): string {
  return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${width}&q=70`;
}

/**
 * The salon's logo.
 *
 * Read from `public_settings.logo` first, exactly like every other image.
 * This is only what the site falls back to while the file is sitting in
 * /public rather than in Supabase Storage — put it in the bucket, record the
 * path on the organization, and this stops being reached without any page
 * being edited.
 *
 * Gold on black, and rendered with `blend-gold` so the black disappears into
 * the page. See the note on that utility in globals.css.
 */
export function stockLogo(): StockPhoto {
  return {
    url: "/brand/kedus-hair-salon.png",
    alt: "Kedus Hair Salon and Braiding",
  };
}

/**
 * The wide photograph that runs edge to edge under the hero.
 *
 * Landscape, and that is the whole requirement. The frame is twice as wide as
 * it is tall, and a portrait cropped into it lands somewhere across the
 * subject's eyes — there is no object-position that rescues it.
 */
export function stockBanner(): StockPhoto {
  return {
    url: sized("1600948836101-f9ffda59d250", 2000),
    alt: "Styling chairs facing round mirrors along a salon wall",
  };
}

/*
 * Thumbnails for the price list — the small square beside each style. Close
 * crops, because at that size a full-length photograph is a smudge.
 */
const STYLE_PHOTOS: StockPhoto[] = [
  {
    url: sized("1759756655332-d66200497312", 400),
    alt: "A close view of long dark braids",
  },
  {
    url: sized("1677319378211-06f6a50b49bd", 400),
    alt: "A single braid photographed close up",
  },
  {
    url: sized("1760341682509-17de8599c68c", 400),
    alt: "Braided hair tied with ribbon",
  },
  {
    url: sized("1638794249638-b97e05aaa900", 400),
    alt: "Long locs against a painted wall",
  },
  {
    url: sized("1630695300380-712176e33bbc", 400),
    alt: "A woman photographed from behind, hair styled and set",
  },
  {
    url: sized("1612690207805-a3c172ea6e8c", 400),
    alt: "Hair styled away from the face, photographed in profile",
  },
  {
    url: sized("1580618672591-eb180b1a973f", 400),
    alt: "A round brush and a dryer at work on wet hair",
  },
  {
    url: sized("1560869713-7d0a29430803", 400),
    alt: "A curling iron being worked through a section of hair",
  },
  {
    url: sized("1595475884562-073c30d45670", 400),
    alt: "Brushes, scissors and a tinting brush laid out",
  },
  {
    url: sized("1562322140-8baeececf3df", 400),
    alt: "A stylist drying a client's hair",
  },
];

/*
 * Larger photographs — the recent-work grid and the strip of clips.
 */
const WORK_PHOTOS: StockPhoto[] = [
  {
    url: sized("1634449571010-02389ed0f9b0", 1000),
    alt: "A stylist working on a client in the chair",
  },
  {
    url: sized("1574015974293-817f0ebebb74", 1000),
    alt: "A finished style photographed in the salon",
  },
  {
    url: sized("1633681926022-84c23e8cb2d6", 1000),
    alt: "A salon floor with chairs, mirrors and a brick wall",
  },
  {
    url: sized("1521590832167-7bcbfaa6381f", 1000),
    alt: "Chairs along a mirrored counter, ready for the day",
  },
  {
    url: sized("1681387744797-4eb711161586", 1000),
    alt: "A long braid worn over one shoulder",
  },
  {
    url: sized("1614173968962-0e61c5ed196f", 1000),
    alt: "Box braids gathered and tied back",
  },
];

/**
 * Turns any text into a number, so the same service always gets the same
 * photograph.
 *
 * Picking at random would give a different picture on every page load — the
 * price list would flicker as you scrolled back to it. This is not a security
 * hash and does not need to be a good one; it needs to be the same answer
 * every time, which is all `<< 5` and a running total gives you.
 */
function hash(text: string): number {
  let total = 0;

  for (let i = 0; i < text.length; i++) {
    total = (total << 5) - total + text.charCodeAt(i);
    total |= 0; // keep it a 32-bit integer rather than drifting into floats
  }

  return Math.abs(total);
}

/** A stable thumbnail for a named service. */
export function stockStylePhoto(serviceName: string): StockPhoto {
  return STYLE_PHOTOS[hash(serviceName) % STYLE_PHOTOS.length]!;
}

/** A stable large photograph for position `index` in a list. */
export function stockWorkPhoto(index: number): StockPhoto {
  return WORK_PHOTOS[index % WORK_PHOTOS.length]!;
}

/** How many large photographs exist, so a caller can fill a grid. */
export const STOCK_WORK_COUNT = WORK_PHOTOS.length;
