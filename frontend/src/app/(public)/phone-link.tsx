/**
 * The salon's phone number, as something you can press.
 *
 * Every "please call us" on the site used to print the number as plain text.
 * On a phone — which is where most of these are read — that means copying
 * eleven digits by hand into the dialler, and it is the exact moment somebody
 * gives up on booking.
 *
 * A component rather than the same `tel:` link written out in six files,
 * because the rule for turning a printed number into a dialable one lives in
 * one place or it drifts.
 */
export function PhoneLink({
  phone,
  fallback = "the salon",
}: {
  phone: string | null;
  fallback?: string;
}) {
  /*
   * No number to call is an ordinary state, not a fault — a salon that has
   * not filled its phone number in gets a readable sentence rather than an
   * empty link. A fragment, so the sentence around it closes up naturally.
   */
  if (!phone) return <>{fallback}</>;

  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      className="whitespace-nowrap underline decoration-brand/40 underline-offset-4 transition-colors hover:text-brand hover:decoration-brand"
    >
      {phone}
    </a>
  );
}
