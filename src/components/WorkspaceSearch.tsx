import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { SearchMatch, SearchSuggestion } from "../search/types";
import type { WorkspaceSearchController } from "../search/useWorkspaceSearch";

interface WorkspaceSearchProps {
  controller: WorkspaceSearchController;
  compact?: boolean;
  onOpenResult: (match: SearchMatch) => Promise<void>;
  onOpenSuggestion: (suggestion: SearchSuggestion) => void;
}

export function WorkspaceSearch({ compact = false, controller, onOpenResult, onOpenSuggestion }: WorkspaceSearchProps) {
  const [query, setQuery] = useState(controller.query);
  const [relativeDirectory, setRelativeDirectory] = useState(controller.relativeDirectory);
  const [caseSensitive, setCaseSensitive] = useState(controller.caseSensitive);

  useEffect(() => {
    setQuery(controller.query);
    setRelativeDirectory(controller.relativeDirectory);
    setCaseSensitive(controller.caseSensitive);
  }, [controller.caseSensitive, controller.query, controller.relativeDirectory]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void controller.run(query, relativeDirectory, caseSensitive);
  }

  const busy = controller.status === "starting" || controller.status === "searching";
  const hasResults = controller.matches.length > 0 || controller.suggestions.length > 0;
  const folderSuggestions = controller.suggestions.filter((suggestion) => suggestion.kind === "directory");
  const fileSuggestions = controller.suggestions.filter((suggestion) => suggestion.kind === "file");

  return (
    <div className={`workspace-search${compact ? " workspace-search-compact" : ""}`}>
      <form className={`workspace-search-form${compact ? " workspace-search-form-compact" : ""}`} onSubmit={submit}>
        <label className="workspace-search-label" htmlFor="workspace-search-query">Search workspace</label>
        <div className="workspace-search-input-row">
          <input
            aria-label="Search workspace"
            autoComplete="off"
            className="workspace-search-input"
            id="workspace-search-query"
            name="searchQuery"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={compact ? "Search files…" : "Find text in files"}
            spellCheck={false}
            value={query}
          />
          <button aria-label="Search workspace" className="workspace-search-submit" disabled={busy || !query.trim()} type="submit">
            {compact ? "⌕" : "Search"}
          </button>
        </div>
        <input
          aria-label="Search folder scope"
          className="workspace-search-scope"
          id="workspace-search-scope"
          name="relativeDirectory"
          onChange={(event) => setRelativeDirectory(event.target.value)}
          placeholder="Folder scope (optional)"
          spellCheck={false}
          value={relativeDirectory}
        />
        <label className="workspace-search-check">
          <input checked={caseSensitive} id="workspace-search-case-sensitive" name="caseSensitive" onChange={(event) => setCaseSensitive(event.target.checked)} type="checkbox" />
          Match case
        </label>
        <div className="workspace-search-actions">
          {busy ? <button className="editor-quiet-button" onClick={() => void controller.cancel()} type="button">Cancel</button> : null}
          {!busy && (hasResults || controller.status === "noMatch" || controller.status === "error") ? <button className="editor-quiet-button" onClick={controller.clear} type="button">Clear</button> : null}
        </div>
      </form>

      {!compact && controller.status === "idle" ? <p className="explorer-state">Search runs against the workspace files on disk.</p> : null}
      {controller.status === "noMatch" && controller.suggestions.length === 0 ? <p className="explorer-state">No matches.</p> : null}
      {controller.status === "cancelled" ? <p className="explorer-state">Search cancelled.</p> : null}
      {controller.error ? <p className="explorer-error" role="alert">{controller.error}</p> : null}
      {controller.result?.partialReason ? <p className="workspace-search-warning">Partial results: {controller.result.partialReason}</p> : null}
      {controller.result?.warnings.map((warning) => <p className="workspace-search-warning" key={warning}>{warning}</p>)}

      {compact ? (
        hasResults ? (
          <div aria-label="Search results" className="workspace-search-split-results">
            <section className="workspace-search-result-column" aria-label="Folder results">
              <p className="workspace-search-section-label">Folders</p>
              {folderSuggestions.length > 0 ? folderSuggestions.map((suggestion) => (
                <button
                  className={`workspace-search-suggestion${suggestion.exact ? " workspace-search-suggestion-exact" : ""}`}
                  key={`${suggestion.kind}:${suggestion.relativePath}`}
                  onClick={() => onOpenSuggestion(suggestion)}
                  type="button"
                >
                  <span className="workspace-search-suggestion-path">{suggestion.relativePath}</span>
                  {suggestion.exact ? <span className="workspace-search-suggestion-match">Exact</span> : null}
                </button>
              )) : <p className="workspace-search-column-empty">No folder match</p>}
            </section>
            <section className="workspace-search-result-column" aria-label="File results">
              <p className="workspace-search-section-label">Files</p>
              {fileSuggestions.map((suggestion) => (
                <button
                  className={`workspace-search-suggestion${suggestion.exact ? " workspace-search-suggestion-exact" : ""}`}
                  key={`${suggestion.kind}:${suggestion.relativePath}`}
                  onClick={() => onOpenSuggestion(suggestion)}
                  type="button"
                >
                  <span className="workspace-search-suggestion-path">{suggestion.relativePath}</span>
                  {suggestion.exact ? <span className="workspace-search-suggestion-match">Exact</span> : null}
                </button>
              ))}
              {controller.matches.map((match, index) => (
                <button
                  className="workspace-search-result"
                  key={`${match.relativePath}:${match.line}:${match.column}:${index}`}
                  onClick={() => void onOpenResult(match)}
                  type="button"
                >
                  <span className="workspace-search-result-location">{match.relativePath}:{match.line}:{match.column}</span>
                  <span className="workspace-search-result-snippet">{match.snippet}</span>
                </button>
              ))}
              {fileSuggestions.length === 0 && controller.matches.length === 0 ? <p className="workspace-search-column-empty">No file match</p> : null}
            </section>
          </div>
        ) : null
      ) : (
        <>
          {controller.suggestions.length > 0 ? (
            <div aria-label="Search suggestions" className="workspace-search-suggestions">
              <p className="workspace-search-section-label">Suggestions</p>
              {controller.suggestions.map((suggestion) => (
                <button
                  className={`workspace-search-suggestion${suggestion.exact ? " workspace-search-suggestion-exact" : ""}`}
                  key={`${suggestion.kind}:${suggestion.relativePath}`}
                  onClick={() => onOpenSuggestion(suggestion)}
                  type="button"
                >
                  <span className="workspace-search-suggestion-kind">{suggestion.kind === "directory" ? "DIR" : "FILE"}</span>
                  <span className="workspace-search-suggestion-path">{suggestion.relativePath}</span>
                  {suggestion.exact ? <span className="workspace-search-suggestion-match">Exact</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          {controller.matches.length > 0 ? (
            <div aria-label="Search results" className="workspace-search-results">
              {controller.matches.map((match, index) => (
                <button
                  className="workspace-search-result"
                  key={`${match.relativePath}:${match.line}:${match.column}:${index}`}
                  onClick={() => void onOpenResult(match)}
                  type="button"
                >
                  <span className="workspace-search-result-location">{match.relativePath}:{match.line}:{match.column}</span>
                  <span className="workspace-search-result-snippet">{match.snippet}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
