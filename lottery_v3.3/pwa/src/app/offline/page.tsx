export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-solana-dark">
      <div className="text-center p-8">
        <svg
          className="mx-auto h-16 w-16 text-solana-purple mb-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
          />
        </svg>
        <h1 className="text-3xl font-bold text-white mb-2">You're Offline</h1>
        <p className="text-gray-400 mb-6">
          Please check your internet connection to continue playing.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="bg-solana-purple hover:bg-purple-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}