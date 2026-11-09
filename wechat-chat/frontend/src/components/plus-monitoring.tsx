"use client";

import { useEffect, useRef } from "react";
import { Radio, Send, X } from "lucide-react";
import type { Status } from "@/lib/api";

export function PlusMonitoring({ status }: { status: Status | null }) {
  if (!status || !["wxautox4", "wxauto4"].includes(status.mode)) return null;
  const monitoring = status.monitoring;
  const active = status.mode === "wxautox4";
  return <article className="settings-card" aria-label="Plusの監視範囲">
    <div className="card-heading"><Radio size={21}/><h2>Plusの監視範囲</h2><span className="soft-tag">{active ? "一部の会話" : "準備中"}</span></div>
    {active ? <p>{status.detail}</p> : <p>現在は無料Readerで読み取っています。Plusは、このWindows PCで購入・ライセンス認証を済ませてから接続を検証します。</p>}
    {monitoring ? <dl>
      <div><dt>監視中</dt><dd>{monitoring.registered}件</dd></div>
      <div><dt>画面上で発見した会話</dt><dd>{monitoring.discovered}件</dd></div>
      <div><dt>同名で識別できない会話</dt><dd>{monitoring.ambiguous}件</dd></div>
      <div><dt>登録に失敗した回数</dt><dd>{monitoring.registration_failures}回</dd></div>
      <div><dt>同時監視の上限</dt><dd>{monitoring.limit}件</dd></div>
      <div><dt>今回の再接続</dt><dd>{monitoring.reconnections}回</dd></div>
    </dl> : null}
    <p className="help">監視する会話はWeChatの別ウィンドウで開きます。未登録の会話・画面外の履歴・切断中の新着は、完全に取得できたとは扱いません。</p>
    <p className="help">WeChat再起動後は本人のログインとアカウントの一致を確認します。過去の宛先を名前だけで結び直さず、送信前に現在の会話を確認します。</p>
  </article>;
}

export type SendReview = { chatId: string; externalId: string; name: string; type: "individual" | "group"; text: string };

export function RealSendReview({ review, enabled, onCancel, onConfirm }: {
  review: SendReview; enabled: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return <dialog ref={dialog} className="task-dialog" aria-labelledby="real-send-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <header><span className="eyebrow">SEND WITH WECHAT</span><button className="icon-button" aria-label="送信確認を閉じる" onClick={onCancel}><X size={19}/></button></header>
    <h2 id="real-send-title">宛先と本文を確認</h2>
    <p className="assist-caption">{review.type === "group" ? "グループへの送信です。参加者全員が閲覧できます。" : "この相手にWindows版WeChatを通じて送ります。"}</p>
    <div className="task-source"><strong>{review.name}</strong><blockquote>{review.text}</blockquote></div>
    {!enabled ? <p role="status" className="error-text">接続または宛先の状態が変わりました。閉じて会話を確認し直してください。</p> : null}
    <footer><button className="secondary" autoFocus onClick={onCancel}>下書きに戻る</button><button className="primary" disabled={!enabled} onClick={onConfirm}><Send size={16}/>この宛先に送信</button></footer>
  </dialog>;
}
