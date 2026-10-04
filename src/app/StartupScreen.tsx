export function StartupScreen() {
  return (
    <main className="startup-screen" aria-label="Loading Vibe Rider">
      <div className="startup-card">
        <div className="startup-chrome"><span>...</span></div>
        <div className="startup-content">
          <img alt="Cheerful Oguri Cap chibi mascot" className="startup-character" src="/assets/vibe-rider-splash-oguri-smile.png" />
          <h1>Vibe Rider</h1>
          <p>&gt; initializing workspace...</p>
        </div>
        <div className="startup-progress" aria-hidden="true"><span /></div>
      </div>
    </main>
  );
}
