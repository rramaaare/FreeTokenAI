"use client";

import { ArrowDown, FileText, ImageIcon, Play, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  appendChatMessage,
  CHAT_CHANGED,
  CHAT_NEW,
  createChatSession,
  getChatMessages,
  hydrateMessages,
  loadOlderMessages,
  type ChatAttachment,
  type ChatMessage,
} from "@/lib/chat-history";
import { DEFAULT_CHAT_MODEL } from "@/lib/chat-models";
import { useT, type TKey } from "@/lib/i18n";
import { notifyTokensExhausted } from "@/lib/token-events";
import {
  fetchWorkspace,
  getAppSettings,
  notifyWorkspaceChanged,
  SETTINGS_CHANGED,
  WORKSPACE_CHANGED,
} from "@/lib/settings";
import ChatInput from "./ChatInput";
import SuggestionCard from "./SuggestionCard";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  isError?: boolean;
  finishReason?: string | null;
  attachments?: ChatAttachment[];
};

function toMessage(m: ChatMessage): Message {
  return {
    id: m.id,
    role: m.role,
    text: m.content,
    finishReason: m.finish_reason ?? null,
    attachments: m.attachments,
  };
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function canContinue(message: Message): boolean {
  return (
    message.role === "assistant" &&
    (message.finishReason === "length" ||
      message.finishReason === "aborted" ||
      message.finishReason === "token_exhausted")
  );
}

const SUGGESTIONS: { icon: "file" | "pen" | "help"; title: TKey; desc: TKey }[] = [
  { icon: "file", title: "suggest.summarize.title", desc: "suggest.summarize.desc" },
  { icon: "pen", title: "suggest.write.title", desc: "suggest.write.desc" },
  { icon: "help", title: "suggest.ask.title", desc: "suggest.ask.desc" },
];

// ponytail: markdown-lite tanpa dep baru — cukup bold/italic/code + link, yang lain tampil polos.
function renderInline(text: string, keyPrefix: string) {
  return text.split(/(https?:\/\/[^\s)]+|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (/^https?:\/\//.test(part))
      return (
        <a
          key={key}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline break-all"
        >
          {part}
        </a>
      );
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**"))
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*"))
      return <em key={key}>{part.slice(1, -1)}</em>;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`"))
      return (
        <code
          key={key}
          className="rounded bg-neutral-100 px-1 py-0.5 text-[13px] dark:bg-neutral-800"
        >
          {part.slice(1, -1)}
        </code>
      );
    return <span key={key}>{part}</span>;
  });
}

// ponytail: potong ekor "Referensi:"/"References:" dari jawaban AI jadi blok sumber tersendiri.
function splitReferences(text: string): { body: string; refs: string[] } {
  const m = text.match(/\n\s*(?:\*\*)?(?:Referensi(?:-sumber)?|References?)(?:\*\*)?\s*:?\s*\n?([\s\S]*)$/i);
  if (!m) return { body: text, refs: [] };
  const refs = m[1]
    .split("\n")
    .map((l) => l.replace(/^[\s*\-\d.)\]•]+/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!refs.length) return { body: text, refs: [] };
  return { body: text.slice(0, m.index).trimEnd(), refs };
}

const AssistantBubble = memo(function AssistantBubble({
  text,
  isError,
}: {
  text: string;
  isError?: boolean;
}) {
  const { t } = useT();
  const { body, refs } = splitReferences(text);
  return (
    <div
      className={`max-w-none whitespace-pre-wrap text-[15px] leading-relaxed ${
        isError
          ? "text-red-600 dark:text-red-400"
          : "text-neutral-800 dark:text-neutral-200"
      }`}
    >
      {renderInline(body, "a")}
      {refs.length > 0 && (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {t("chat.references")}
          </p>
          <ul className="flex flex-col gap-1">
            {refs.map((r, i) => (
              <li key={i} className="text-[13px] leading-relaxed">
                <span className="mr-1.5 text-neutral-400">{i + 1}.</span>
                {renderInline(r, `ref-${i}`)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

function TypingIndicator() {
  return (
    <div className="flex gap-1.5 text-neutral-400 dark:text-neutral-500">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
    </div>
  );
}

const UserBubble = memo(function UserBubble({
  text,
  attachments,
}: {
  text: string;
  attachments?: ChatAttachment[];
}) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl bg-primary-soft px-4 py-2.5 text-[15px] text-neutral-900 dark:bg-neutral-800 dark:text-white">
        <div className="whitespace-pre-wrap">{text}</div>
        {attachments && attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <span
                key={a.id}
                className="flex max-w-full items-center gap-1.5 rounded-full border border-black/10 bg-white/60 px-2 py-1 text-[11px] dark:border-white/10 dark:bg-neutral-900/60"
                title={a.filename}
              >
                {a.kind === "image" ? <ImageIcon size={12} /> : <FileText size={12} />}
                <span className="max-w-[10rem] truncate">{a.filename}</span>
                <span className="shrink-0 opacity-60">{sizeLabel(a.size_bytes)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

type StreamCallbacks = {
  onDone: (sessionId: string, reply: string, finishReason: string) => void;
  onError: (err: string) => void;
  onStop: (partial: string) => void;
};

function useStreamingChat() {
  const { lang } = useT();
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const accumulatedRef = useRef("");
  const flushTimerRef = useRef<number | null>(null);

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushNow = useCallback(() => {
    clearFlushTimer();
    setStreamingText(accumulatedRef.current);
  }, [clearFlushTimer]);

  const pushChunk = useCallback((text: string) => {
    accumulatedRef.current += text;
    if (flushTimerRef.current !== null) return;
    // Batch update ±50ms supaya streaming panjang tidak memicu re-render tiap token.
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      setStreamingText(accumulatedRef.current);
    }, 50);
  }, []);

  const run = useCallback(
    async (url: string, body: Record<string, unknown>, callbacks: StreamCallbacks) => {
      if (runningRef.current) return false;
      runningRef.current = true;
      accumulatedRef.current = "";
      setStreamingText("");
      setIsStreaming(true);
      abortRef.current = new AbortController();

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: { code?: string; message?: string };
          };
          if (data?.error?.code === "INSUFFICIENT_TOKENS" || data?.error?.code === "WORKSPACE_EXPIRED") notifyTokensExhausted();
          throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        const requestSessionId = typeof body.session_id === "string" ? body.session_id : "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            let parsed: {
              text?: string;
              done?: boolean;
              error?: { code?: string; message?: string };
              sessionId?: string;
              finishReason?: string;
            };
            try {
              parsed = JSON.parse(raw);
            } catch {
              continue;
            }

            if (parsed.error) {
              if (parsed.error.code === "INSUFFICIENT_TOKENS" || parsed.error.code === "WORKSPACE_EXPIRED") notifyTokensExhausted();
              throw new Error(parsed.error.message ?? "Streaming error");
            }
            if (parsed.text) pushChunk(parsed.text);
            if (parsed.done) {
              flushNow();
              setIsStreaming(false);
              runningRef.current = false;
              callbacks.onDone(
                parsed.sessionId ?? requestSessionId,
                accumulatedRef.current,
                parsed.finishReason ?? "stop",
              );
              return true;
            }
          }
        }

        flushNow();
        setIsStreaming(false);
        runningRef.current = false;
        callbacks.onDone(requestSessionId, accumulatedRef.current, "stop");
        return true;
      } catch (e) {
        flushNow();
        setIsStreaming(false);
        runningRef.current = false;
        if (e instanceof DOMException && e.name === "AbortError") {
          callbacks.onStop(accumulatedRef.current);
        } else if (abortRef.current?.signal.aborted) {
          callbacks.onStop(accumulatedRef.current);
        } else {
          callbacks.onError(e instanceof Error ? e.message : lang === "en" ? "streaming failed" : "Streaming gagal");
        }
        return false;
      } finally {
        // giliran selesai (sukses/stop/gagal) = saldo sudah dipotong server — segarkan TopBar.
        notifyWorkspaceChanged();
      }
    },
    [flushNow, pushChunk, lang],
  );

  const start = useCallback(
    (
      args: {
        sessionId: string;
        message: string;
        history: { role: string; content: string }[];
        model: string;
        attachmentIds: string[];
        lang: string;
      },
      callbacks: StreamCallbacks,
    ) =>
      run(
        "/api/chat/stream",
        {
          message: args.message,
          history: args.history,
          model: args.model,
          session_id: args.sessionId,
          attachment_ids: args.attachmentIds,
          lang: args.lang,
        },
        callbacks,
      ),
    [run],
  );

  const continueFrom = useCallback(
    (sessionId: string, model: string, lang: string, callbacks: StreamCallbacks) =>
      run("/api/chat/stream", { continue: true, session_id: sessionId, model, lang }, callbacks),
    [run],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearFlushTimer();
    };
  }, [clearFlushTimer]);

  return { streamingText, isStreaming, start, continueFrom, stop };
}

export default function ChatPanel({ sessionId }: { sessionId?: string }) {
  const { t, lang, locale } = useT();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  // ponytail: nilai awal SSR-safe dulu; simpanan localStorage dibaca setelah mount
  // (baca di initializer = hydration mismatch server vs client).
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL);
  useEffect(() => {
    setModel(getAppSettings().defaultModel);
  }, []);
  const [hasMore, setHasMore] = useState(false);
  // ponytail: tanggal aktif = expires_at dari /api/v1/workspace, bukan teks statis.
  const [expiresLabel, setExpiresLabel] = useState("");
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void fetchWorkspace().then((w) => {
        if (!alive) return;
        setExpiresLabel(
          w.expiresAt
            ? new Date(w.expiresAt).toLocaleDateString(locale, { day: "numeric", month: "long" })
            : "",
        );
      });
    };
    refresh();
    window.addEventListener(WORKSPACE_CHANGED, refresh);
    window.addEventListener(SETTINGS_CHANGED, refresh);
    return () => {
      alive = false;
      window.removeEventListener(WORKSPACE_CHANGED, refresh);
      window.removeEventListener(SETTINGS_CHANGED, refresh);
    };
  }, [locale]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(false);
  const [continuingId, setContinuingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const assistantMsgIdRef = useRef<string>("");
  const { streamingText, isStreaming, start, continueFrom, stop } = useStreamingChat();

  const reloadMessages = useCallback((id: string) => {
    setMessages(getChatMessages(id).map(toMessage));
  }, []);

  // ponytail: buka sesi lama = muat halaman terakhir dari DB (bukan semua pesan).
  // Job latar yang selesai saat user di page lain ikut masuk via subscription.
  useEffect(() => {
    if (!sessionId) return;
    setIsSending(false);
    reloadMessages(sessionId);
    let alive = true;
    void hydrateMessages(sessionId).then((page) => {
      if (!alive) return;
      setHasMore(page.hasMore);
      reloadMessages(sessionId);
    });

    const refresh = () => reloadMessages(sessionId);
    window.addEventListener(CHAT_CHANGED, refresh);
    return () => {
      alive = false;
      window.removeEventListener(CHAT_CHANGED, refresh);
    };
  }, [sessionId, reloadMessages]);

  // ponytail: Obrolan Baru saat sudah di /dashboard = reset draft.
  useEffect(() => {
    if (sessionId) return;
    const reset = () => setMessages([]);
    window.addEventListener(CHAT_NEW, reset);
    return () => window.removeEventListener(CHAT_NEW, reset);
  }, [sessionId]);

  useEffect(() => {
    if (!atBottom) {
      if (isStreaming) setNewBelow(true);
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: isStreaming ? "auto" : "smooth" });
  }, [messages, streamingText, isStreaming, atBottom]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const bottom = distance < 80;
    setAtBottom(bottom);
    if (bottom) setNewBelow(false);
  }

  function scrollToBottom() {
    setAtBottom(true);
    setNewBelow(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  async function loadOlder() {
    if (!sessionId || loadingOlder || !hasMore || !messages.length) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    const result = await loadOlderMessages(sessionId, messages[0].id);
    setHasMore(result.hasMore);
    reloadMessages(sessionId);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight + prevTop;
    });
    setLoadingOlder(false);
  }

  function handleStop() {
    stop();
  }

  async function handleSend(text: string, attachments: ChatAttachment[]): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed || isSending) return false;

    // Jangan navigasi sebelum stream selesai: unmount akan membatalkan fetch.
    let id = sessionId;
    let isNew = false;
    if (!id) {
      const created = await createChatSession();
      id = created.id;
      isNew = true;
    }
    const target = id;
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text: trimmed, attachments };
    const historyForApi = [...messages, userMsg]
      .slice(-21, -1)
      .map((m) => ({ role: m.role, content: m.text }));

    setMessages((prev) => [...prev, userMsg]);
    setAtBottom(true);
    setNewBelow(false);
    setIsSending(true);
    setContinuingId(null);
    appendChatMessage(target, "user", trimmed);

    assistantMsgIdRef.current = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantMsgIdRef.current, role: "assistant", text: "" }]);

    void start(
      {
        sessionId: target,
        message: trimmed,
        history: historyForApi,
        model,
        attachmentIds: attachments.map((a) => a.id),
        lang,
      },
      {
        onDone: (finalSessionId, reply, finishReason) => {
          setIsSending(false);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgIdRef.current ? { ...m, text: reply, finishReason } : m,
            ),
          );
          void hydrateMessages(finalSessionId).then((page) => {
            setHasMore(page.hasMore);
            reloadMessages(finalSessionId);
          });
          if (isNew) router.replace(`/dashboard/chat/${finalSessionId}`);
        },
        onError: (err) => {
          setIsSending(false);
          const errMsg = `${t("chat.sorry")} ${err}`;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgIdRef.current
                ? { ...m, text: errMsg, isError: true, finishReason: "error" }
                : m,
            ),
          );
          if (isNew) router.replace(`/dashboard/chat/${target}`);
        },
        onStop: (partial) => {
          setIsSending(false);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgIdRef.current
                ? { ...m, text: partial || t("chat.stopped"), finishReason: "aborted" }
                : m,
            ),
          );
          if (isNew) router.replace(`/dashboard/chat/${target}`);
        },
      },
    ).then((ok) => {
      if (!ok) setIsSending(false);
    });

    return true;
  }

  async function handleContinue() {
    const last = messages[messages.length - 1];
    if (!sessionId || isSending || !last || !canContinue(last)) return;

    setContinuingId(last.id);
    setIsSending(true);
    setAtBottom(true);
    setNewBelow(false);

    await continueFrom(sessionId, model, lang, {
      onDone: (_sessionId, reply, finishReason) => {
        setIsSending(false);
        setContinuingId(null);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === last.id ? { ...m, text: m.text + reply, finishReason } : m,
          ),
        );
        void hydrateMessages(sessionId).then((page) => {
          setHasMore(page.hasMore);
          reloadMessages(sessionId);
        });
      },
      onError: (err) => {
        setIsSending(false);
        setContinuingId(null);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `${t("chat.sorry")} ${err}`,
            isError: true,
            finishReason: "error",
          },
        ]);
      },
      onStop: (partial) => {
        setIsSending(false);
        setContinuingId(null);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === last.id
              ? { ...m, text: m.text + (partial || t("chat.stopped")), finishReason: "aborted" }
              : m,
          ),
        );
      },
    });
  }

  if (messages.length === 0) {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-4 pt-6 pb-4 md:px-6 md:pt-10 lg:pt-12 lg:pb-8">
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          {expiresLabel && (
            <span className="flex items-center gap-2 rounded-full border border-neutral-200 px-4 py-1.5 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
              <Wand2 size={14} className="text-primary" />
              {t("chat.activeUntil", { date: expiresLabel })}
            </span>
          )}

          <h1 className="text-center text-2xl font-medium text-neutral-900 md:text-4xl dark:text-white">
            {t("chat.headline")}
          </h1>
        </div>

        <div className="flex flex-col gap-3 lg:gap-4">
          <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:gap-4">
            {SUGGESTIONS.map((card) => (
              <SuggestionCard
                key={card.title}
                icon={card.icon}
                title={t(card.title)}
                description={t(card.desc)}
              />
            ))}
          </div>

          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            isSending={isSending || isStreaming}
            model={model}
            onModelChange={setModel}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="no-scrollbar h-full overflow-y-auto"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
            {hasMore && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {loadingOlder ? t("chat.loading") : t("chat.loadOlder")}
                </button>
              </div>
            )}

            {messages.map((message, index) => {
              const isLast = index === messages.length - 1;
              if (message.role === "user")
                return <UserBubble key={message.id} text={message.text} attachments={message.attachments} />;

              const live =
                continuingId === message.id ||
                (isStreaming && message.id === assistantMsgIdRef.current);
              const displayText = message.text + (live ? streamingText : "");

              return (
                <div key={message.id}>
                  <AssistantBubble text={displayText} isError={message.isError} />
                  {message.finishReason === "aborted" && !isSending && (
                    <p className="mt-1.5 text-[11px] text-neutral-400">{t("chat.stoppedShort")}</p>
                  )}
                  {isLast && !isSending && canContinue(message) && (
                    <button
                      type="button"
                      onClick={() => void handleContinue()}
                      className="mt-2 flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    >
                      <Play size={12} />
                      {t("chat.continue")}
                    </button>
                  )}
                </div>
              );
            })}

            {isSending && !streamingText && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
        </div>

        {!atBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label={t("chat.scrollBottom")}
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-md transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            <ArrowDown size={14} />
            {newBelow ? t("chat.newMessages") : t("chat.toBottom")}
          </button>
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6 md:pb-6">
        <ChatInput
          onSend={handleSend}
          onStop={handleStop}
          isSending={isSending || isStreaming}
          model={model}
          onModelChange={setModel}
          compact
        />
      </div>
    </div>
  );
}
