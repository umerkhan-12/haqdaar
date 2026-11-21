import Link from 'next/link';

/** Served by the service worker when a page is not cached and there is no network. */
export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-10 text-center">
      <p className="text-6xl" aria-hidden>
        📶
      </p>
      <h1 className="text-2xl font-bold">انٹرنیٹ نہیں ہے</h1>
      <p className="text-lg">
        آپ کی درخواستیں فون میں محفوظ ہیں اور انٹرنیٹ آتے ہی خود بھیج دی جائیں گی۔
      </p>
      <p className="latin text-muted" dir="ltr" lang="en">
        No internet. Your claims are saved on this phone and will be sent automatically.
      </p>
      <Link
        href="/citizen"
        className="inline-block min-h-12 rounded-xl bg-brand px-5 py-3 text-lg font-semibold text-white"
      >
        حقدار
      </Link>
    </main>
  );
}
