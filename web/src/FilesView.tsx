import { useEffect, useState } from "react";

export interface ConfigDocumentPreview {
  file: string;
  path: string;
  content: string | null;
}

export interface ConfigPreview {
  documents: ConfigDocumentPreview[];
  configVersion: string;
}

export interface FileFeedback {
  tone: "ok" | "bad";
  message: string;
}

export async function reloadConfigDocument(
  current: ConfigDocumentPreview[],
  file: string,
  loadPreview: () => Promise<ConfigPreview>,
): Promise<ConfigDocumentPreview[]> {
  const preview = await loadPreview();
  const replacement = preview.documents.find((document) => document.file === file);
  if (replacement === undefined) {
    throw new Error("canonical_document_missing");
  }
  return current.map((document) =>
    document.file === file ? replacement : document,
  );
}

export async function copyConfigPath(
  path: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined,
): Promise<void> {
  if (clipboard === undefined) throw new Error("clipboard_unavailable");
  await clipboard.writeText(path);
}

export function FilesView({
  loadPreview,
}: {
  loadPreview: () => Promise<ConfigPreview>;
}) {
  const [documents, setDocuments] = useState<ConfigDocumentPreview[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, FileFeedback>>({});

  useEffect(() => {
    loadPreview()
      .then((preview) => {
        setDocuments(preview.documents);
        setLoadError(null);
      })
      .catch(() => setLoadError("The canonical configuration preview could not be loaded."));
  }, [loadPreview]);

  async function reload(file: string): Promise<void> {
    try {
      const next = await reloadConfigDocument(documents, file, loadPreview);
      setDocuments(next);
      setFeedback({
        ...feedback,
        [file]: { tone: "ok", message: `${file} reloaded from canonical state.` },
      });
    } catch {
      setFeedback({
        ...feedback,
        [file]: { tone: "bad", message: `${file} could not be reloaded.` },
      });
    }
  }

  async function copyPath(document: ConfigDocumentPreview): Promise<void> {
    try {
      await copyConfigPath(document.path, globalThis.navigator?.clipboard);
      setFeedback({
        ...feedback,
        [document.file]: { tone: "ok", message: `Copied the path for ${document.file}.` },
      });
    } catch {
      setFeedback({
        ...feedback,
        [document.file]: {
          tone: "bad",
          message: "Clipboard access is unavailable. Select and copy the displayed path manually.",
        },
      });
    }
  }

  if (loadError !== null) {
    return <div className="notice" data-tone="bad">{loadError}</div>;
  }
  return (
    <>
      <div className="notice">
        Read-only preview. These files stay the single configuration authority
        and remain editable by hand outside this app.
      </div>
      <ConfigDocumentList
        documents={documents}
        feedback={feedback}
        onReload={(file) => void reload(file)}
        onCopy={(document) => void copyPath(document)}
      />
    </>
  );
}

export function ConfigDocumentList({
  documents,
  feedback = {},
  onReload,
  onCopy,
}: {
  documents: ConfigDocumentPreview[];
  feedback?: Record<string, FileFeedback>;
  onReload(file: string): void;
  onCopy(document: ConfigDocumentPreview): void;
}) {
  return documents.map((document) => (
        <section className="config-document" key={document.file} aria-labelledby={`file-${document.file}`}>
          <div className="config-document-heading">
            <div>
              <h2 id={`file-${document.file}`}>{document.file}</h2>
              <p className="muted config-path"><code>{document.path}</code></p>
            </div>
            <div className="row">
              <button className="btn" type="button" onClick={() => onReload(document.file)}>
                Reload
              </button>
              <button className="btn" type="button" onClick={() => onCopy(document)}>
                Copy path
              </button>
            </div>
          </div>
          {feedback[document.file] === undefined ? null : (
            <p
              className="file-feedback"
              data-tone={feedback[document.file]?.tone}
              role="status"
              aria-live="polite"
            >
              {feedback[document.file]?.message}
            </p>
          )}
          <pre>{document.content ?? "(not created yet)"}</pre>
        </section>
      ));
}
