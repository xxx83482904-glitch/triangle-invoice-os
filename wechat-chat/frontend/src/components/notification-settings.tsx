"use client";
import { Bell, Volume2 } from "lucide-react";
import type { ChatNotifications } from "@/lib/notifications";

export default function NotificationSettings({notifications:n}: {notifications:ChatNotifications}) {
  return <article className="settings-card" aria-label="新着通知">
    <div className="card-heading"><Bell size={21}/><h2>新着通知</h2><span className="soft-tag">この端末</span></div>
    <p>届いた通知を押すと、その会話を開いて返信できます。</p>
    <div className="notification-setting"><div><strong>アプリを開いている間の音</strong><small>{n.sound ? n.soundReady ? "通知音はオンです。読んでいる会話では鳴りません。" : "画面を一度タップすると音を有効にします。" : "オンにすると確認音が鳴ります。"}</small></div><button className="secondary" aria-pressed={n.sound} onClick={() => void n.toggleSound()}><Volume2 size={16}/>{n.sound ? "通知音をオフ" : "通知音をオン"}</button></div>
    <div className="notification-setting"><div><strong>画面を閉じている間の通知</strong><small>{n.push ? "この端末に登録済み" : "通知はまだオンになっていません"}</small></div><button className="secondary" disabled={n.busy || (!n.push && (!n.supported || !n.server?.enabled || n.permission === "denied"))} onClick={() => void (n.push ? n.disablePush() : n.enablePush())}>{n.push ? "通知をオフ" : "この端末の通知をオン"}</button></div>
    <p className="help">オンにすると、Apple・Googleなど端末の通知サービスを通して「新着あり」だけを届けます。相手の名前・メッセージ本文・添付ファイルは送りません。</p>
    {!n.supported && <p className="help">iPhoneはSafariの共有 →「ホーム画面に追加」後、追加したアプリから開いてください。HTTPSと通知対応ブラウザが必要です。</p>}
    {n.server && !n.server.enabled && <p className="help">PC側のプッシュ通知設定がまだ有効になっていません。</p>}
    {n.permission === "denied" && <p className="help">端末で通知が拒否されています。ブラウザ・iPhoneの設定で「こもれび」の通知を許可してください。</p>}
    {n.push && <button className="secondary" disabled={n.busy} onClick={() => void n.testPush()}><Bell size={16}/>通知をテスト</button>}
    {n.feedback && <p role="status" className="help">{n.feedback}</p>}
    <p className="help">通知音は端末の消音・集中モード設定に従います。Windowsの起動・WeChatログインと、その会話の監視が必要です。未監視の会話や切断中の着信は通知できません。</p>
  </article>;
}
