import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarClock, Plus, ChevronLeft, Users, User, Pencil, Trash2,
  ImageIcon, Clock, CheckCircle2, XCircle, CircleDashed, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useChannelInstances } from "@/pages/channels/hooks/use-channel-instances";
import type { ChannelInstanceData } from "@/types/channel";
import { useScheduledMessages, type ScheduledMessage, type ScheduledMsgOccurrence } from "./hooks/use-scheduled-messages";
import { ScheduledMessageEditor } from "./scheduled-message-editor";
import { formatVN } from "./vn-time";

export function ScheduledMessagesPage() {
  const { t } = useTranslation("scheduled-messages");
  const { instances } = useChannelInstances();
  const { messages, loading, createMessage, updateMessage, deleteMessage } = useScheduledMessages();

  const [channel, setChannel] = useState<ChannelInstanceData | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledMessage | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Connected channels the user can send from.
  const connectedChannels = useMemo(
    () => instances.filter((c) => c.has_credentials && c.enabled),
    [instances],
  );

  const messagesForChannel = useMemo(
    () => (channel ? messages.filter((m) => m.channel === channel.name) : []),
    [messages, channel],
  );

  const countByChannel = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of messages) map[m.channel] = (map[m.channel] || 0) + 1;
    return map;
  }, [messages]);

  const openCreate = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (m: ScheduledMessage) => { setEditing(m); setEditorOpen(true); };

  const handleSubmit = async (input: Parameters<typeof createMessage>[0]) => {
    if (editing) await updateMessage(editing.batchId, input);
    else await createMessage(input);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteMessage(deleteTarget.batchId);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {channel && (
            <Button variant="ghost" size="icon" onClick={() => setChannel(null)} className="mt-0.5">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <CalendarClock className="h-6 w-6 text-primary" />
              {channel ? (channel.display_name || channel.name) : t("title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {channel ? t("pickChannel.description") : t("description")}
            </p>
          </div>
        </div>
        {channel && (
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> {t("newMessage")}
          </Button>
        )}
      </div>

      {/* Level 1: channel grid */}
      {!channel && (
        <>
          {connectedChannels.length === 0 ? (
            <EmptyBox icon={<MessageSquare className="h-10 w-10" />} title={t("pickChannel.none")} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {connectedChannels.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setChannel(c)}
                  className="group flex flex-col items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-accent/40"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-2xl">
                    {channelEmoji(c.channel_type)}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.display_name || c.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{c.channel_type}</div>
                  </div>
                  {(countByChannel[c.name] ?? 0) > 0 && (
                    <Badge variant="secondary" className="mt-auto">
                      {t("card.occurrences", { count: countByChannel[c.name] ?? 0 })}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Level 2: messages grid for the selected channel */}
      {channel && (
        <>
          {loading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">{t("loading")}</div>
          ) : messagesForChannel.length === 0 ? (
            <EmptyBox
              icon={<CalendarClock className="h-10 w-10" />}
              title={t("empty.title")}
              desc={t("empty.description")}
              action={<Button onClick={openCreate} className="gap-1.5"><Plus className="h-4 w-4" />{t("newMessage")}</Button>}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {messagesForChannel.map((m) => (
                <MessageCard key={m.batchId} msg={m} onEdit={() => openEdit(m)} onDelete={() => setDeleteTarget(m)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Editor */}
      {channel && (
        <ScheduledMessageEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          channel={channel}
          existing={editing}
          onSubmit={handleSubmit}
        />
      )}

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("delete.title")}</DialogTitle>
            <DialogDescription>
              {t("delete.description", { name: deleteTarget?.title || t("untitled") })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t("form.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {t("delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MessageCard({ msg, onEdit, onDelete }: { msg: ScheduledMessage; onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation("scheduled-messages");
  const now = Date.now();
  const sorted = [...msg.occurrences].sort((a, b) => a.timeMs - b.timeMs);
  const upcoming = sorted.filter((o) => o.timeMs > now);
  const next = upcoming[0];

  return (
    <div className="flex flex-col rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{msg.title || t("untitled")}</div>
          {msg.message && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{msg.message}</p>}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Meta chips */}
      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
          <Users className="h-3 w-3" /> {t("card.recipients", { count: msg.targets.length })}
        </span>
        {msg.images.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            <ImageIcon className="h-3 w-3" /> {t("card.images", { count: msg.images.length })}
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
          <Clock className="h-3 w-3" /> {t("card.occurrences", { count: msg.occurrences.length })}
        </span>
      </div>

      {/* Recipients preview */}
      {msg.targets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {msg.targets.slice(0, 4).map((tg) => (
            <Badge key={tg.id} variant="outline" className="gap-1 text-[11px]">
              {tg.type === "group" ? <Users className="h-2.5 w-2.5" /> : <User className="h-2.5 w-2.5" />}
              <span className="max-w-[120px] truncate">{tg.name || tg.id}</span>
            </Badge>
          ))}
          {msg.targets.length > 4 && <Badge variant="outline" className="text-[11px]">+{msg.targets.length - 4}</Badge>}
        </div>
      )}

      {/* Next send */}
      <div className="mt-3 border-t pt-2 text-xs">
        {next ? (
          <span className="text-foreground">{t("card.nextSend", { time: formatVN(next.timeMs) })}</span>
        ) : (
          <span className="text-muted-foreground">{t("card.noUpcoming")}</span>
        )}
      </div>

      {/* Occurrence history */}
      <div className="mt-2 space-y-1">
        {sorted.map((o) => (
          <div key={o.jobId} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{formatVN(o.timeMs)}</span>
            <StatusBadge occ={o} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ occ }: { occ: ScheduledMsgOccurrence }) {
  const { t } = useTranslation("scheduled-messages");
  switch (occ.status) {
    case "sent":
      return <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3 w-3" />{t("status.sent")}</span>;
    case "error":
      return <span className="inline-flex items-center gap-1 text-destructive" title={occ.error}><XCircle className="h-3 w-3" />{t("status.error")}</span>;
    case "disabled":
      return <span className="inline-flex items-center gap-1 text-muted-foreground"><CircleDashed className="h-3 w-3" />{t("status.disabled")}</span>;
    default:
      return <span className="inline-flex items-center gap-1 text-amber-600"><Clock className="h-3 w-3" />{t("status.pending")}</span>;
  }
}

function EmptyBox({ icon, title, desc, action }: { icon: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
      <div className="mb-3 text-muted-foreground">{icon}</div>
      <div className="font-medium">{title}</div>
      {desc && <div className="mt-1 max-w-sm text-sm text-muted-foreground">{desc}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function channelEmoji(type: string): string {
  if (type.includes("zalo")) return "💬";
  if (type.includes("telegram")) return "✈️";
  if (type.includes("whatsapp")) return "🟢";
  if (type.includes("discord")) return "🎮";
  if (type.includes("slack")) return "💼";
  if (type.includes("messenger") || type.includes("facebook")) return "📘";
  return "📨";
}
