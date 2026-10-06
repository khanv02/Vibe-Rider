import { useState } from "react";

const STARTUP_MESSAGES = [
  "Hello there. Your workspace is getting ready.",
  "Welcome back. The editor is finding its rhythm.",
  "Good to see you. Setting up a fresh work session.",
  "Take a breath. Your tools will be ready in a moment.",
  "A quiet workspace is loading around your next idea.",
];

const STARTUP_FACTS = [
  "Fact: The first computer bug was an actual moth found in a relay.",
  "Fact: The word algorithm comes from the name of a ninth-century mathematician.",
  "Fact: A group of programmers is sometimes called a code team.",
  "Fact: The QWERTY layout was designed for mechanical typewriters.",
  "Fact: Small, reversible changes are easier to debug than giant rewrites.",
];

function randomItem(items: string[]) {
  return items[Math.floor(Math.random() * items.length)];
}

export function StartupScreen() {
  const [message] = useState(() => randomItem(STARTUP_MESSAGES));
  const [fact] = useState(() => randomItem(STARTUP_FACTS));

  return (
    <main className="startup-screen" aria-label="Loading Vibe Rider">
      <div className="startup-card">
        <div className="startup-chrome"><span>...</span></div>
        <div className="startup-content">
          <img alt="Cheerful Oguri Cap chibi mascot" className="startup-character" src="/assets/vibe-rider-splash-oguri-smile.png" />
          <h1>Vibe Rider</h1>
          <p>&gt; {message}</p>
          <p>{fact}</p>
        </div>
        <div className="startup-progress" aria-hidden="true"><span /></div>
      </div>
    </main>
  );
}
