"use client";

import { useEffect, useRef, useState } from "react";
import { Download, File, Image as ImageIcon, LoaderCircle, Mic, Video } from "lucide-react";
import { api, Attachment } from "@/lib/api";

const labels = { image: "画像", file: "ファイル", voice: "ボイスメッセージ", video: "動画" };
const icons = { image: ImageIcon, file: File, voice: Mic, video: Video };
const failure: Record<string, string> = {
  source_unavailable: "元のメッセージをWeChatで確認できません。",
  download_failed: "取得できませんでした。WeChat側で開けるか確認してください。",
  transcription_unavailable: "文字起こしを取得できませんでした。",
  too_large: "100 MBを超えるファイルは、このアプリには保存できません。",
  interrupted: "取得が中断されました。必要ならもう一度読み込んでください。",
};

export default function MessageMedia({ attachment, canFetch, onRefresh }: {
  attachment: Attachment; canFetch: boolean; onRefresh: () => Promise<void>;
}) {
  const [local, setLocal] = useState<Attachment | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  const requestLock = useRef(false);
  const value = local || attachment;
  const waiting = value.status === "queued" || value.status === "loading";
  const Icon = icons[value.kind];
  const url = "/api/attachments/" + encodeURIComponent(value.id) + "/content";
  const raster = value.kind === "image" && ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(value.mime_type || "");

  // Poll only a read explicitly requested in this card. This also works while
  // viewing older pages, whose scroll position the global refresh preserves.
  useEffect(() => {
    if (!waiting) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<Attachment>("/attachments/" + value.id);
        if (disposed) return;
        setLocal(result);
        if (result.status === "queued" || result.status === "loading") timer = setTimeout(poll, 2000);
        else void onRefresh();
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : "取得状態を確認できません。");
          timer = setTimeout(poll, 5000);
        }
      }
    };
    timer = setTimeout(poll, 1000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [waiting, value.id, onRefresh]);

  async function read() {
    if (requestLock.current || !canFetch) return;
    requestLock.current = true;
    setRequesting(true);
    setError("");
    try {
      const result = await api<Attachment>("/attachments/" + value.id + "/fetch", {});
      setLocal(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得できませんでした。");
    } finally {
      requestLock.current = false;
      setRequesting(false);
    }
  }

  return <section className="message-media" aria-label={labels[value.kind]}>
    <div className="media-title"><Icon size={17} aria-hidden="true"/><strong>{value.filename || labels[value.kind]}</strong>
      {value.size_bytes !== null && <small>{value.size_bytes < 1024 * 1024 ? Math.ceil(value.size_bytes / 1024) + " KB" : (value.size_bytes / 1024 / 1024).toFixed(1) + " MB"}</small>}
    </div>
    {value.has_content && raster && !imageFailed && <a href={url} target="_blank" rel="noopener noreferrer" aria-label="画像を開く">
      {/* Authenticated, same-origin bytes; no external optimizer or CDN. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="WeChatから保存した画像" loading="lazy" onError={() => setImageFailed(true)}/>
    </a>}
    {imageFailed && <p role="status">画像を表示できません。保存したファイルを確認してください。</p>}
    {value.transcript && <div className="voice-transcript"><small>WeChatの文字起こし</small><p>{value.transcript}</p></div>}
    {value.kind === "voice" && <p className="media-note">原音の取得・再生は未対応です。文字起こしにはWeChatの機能を使います。</p>}
    {value.has_content && <a className="media-action" href={url + "?download=true"} download><Download size={14} aria-hidden="true"/>保存したファイルをダウンロード</a>}
    {value.status !== "ready" && <div className="media-actions">
      {waiting || requesting
        ? <span role="status"><LoaderCircle size={14} className="spin" aria-hidden="true"/>{value.status === "loading" ? "読み込み中…" : "読み込み待ち…"}</span>
        : <button type="button" className="media-action" disabled={!canFetch} onClick={() => void read()}>{value.kind === "voice" ? "文字起こしを読み込む" : "読み込む"}</button>}
    </div>}
    {value.status !== "ready" && !canFetch && <p className="media-note">WeChatに接続し、この会話の監視が有効なときに取得できます。</p>}
    {value.status !== "ready" && value.error_code && <p role="status">{failure[value.error_code] || "取得できませんでした。"}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
