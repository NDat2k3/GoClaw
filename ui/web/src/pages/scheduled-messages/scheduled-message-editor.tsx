import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Upload, X, Loader2, Plus, CalendarClock, ImageIcon, Check } from "lucide-react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useHttp } from "@/hooks/use-ws";
import { toast } from "@/stores/use-toast-store";
import type { ChannelInstanceData } from "@/types/channel";
import { ZaloTargetPicker } from "./zalo-target-picker";
import { msToVNInput, vnInputToMs, defaultNewTimeMs } from "./vn-time";
import type { ScheduledMessage, ScheduledMsgInput, ScheduledMsgTarget } from "./hooks/use-scheduled-messages";

const MAX_IMAGES = 9;

interface ImageItem {
  path: string; // server-side path (relative for fresh upload, absolute for edit round-trip)
  name: string;
  previewUrl?: string; // object URL for instant thumbnail of a fresh upload
  uploading: boolean;
  error?: boolean;
}

interface EditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: ChannelInstanceData;
  existing?: ScheduledMessage | null;
  onSubmit: (input: ScheduledMsgInput) => Promise<void>;
}

export function ScheduledMessageEditor({ open, onOpenChange, channel, existing, onSubmit }: EditorProps) {
  const { t } = useTranslation("scheduled-messages");
  const http = useHttp();
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [targets, setTargets] = useState<ScheduledMsgTarget[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Initialize the form ONLY when the dialog opens or the edited message changes.
  // (Fixes the old bug where edits were wiped on every re-render.)
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setTitle(existing.title || "");
      setMessage(existing.message || "");
      setImages((existing.images || []).map((p) => ({ path: p, name: p.split(/[\\/]/).pop() || p, uploading: false })));
      setTargets(existing.targets || []);
      // On edit we only reschedule future occurrences; seed with the pending ones.
      const now = Date.now();
      const upcoming = (existing.occurrences || []).filter((o) => o.timeMs > now).map((o) => o.timeMs);
      setTimes(upcoming.length > 0 ? upcoming : [defaultNewTimeMs()]);
    } else {
      setTitle("");
      setMessage("");
      setImages([]);
      setTargets([]);
      setTimes([defaultNewTimeMs()]);
    }
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.batchId]);

  const uploading = images.some((i) => i.uploading);

  const handleFiles = async (files: FileList) => {
    const room = MAX_IMAGES - images.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (picked.length === 0) return;

    // Add optimistic items with instant object-URL thumbnails.
    const pending: ImageItem[] = picked.map((f) => ({
      path: "",
      name: f.name,
      previewUrl: URL.createObjectURL(f),
      uploading: true,
    }));
    setImages((prev) => [...prev, ...pending]);

    await Promise.all(
      picked.map(async (file, idx) => {
        const fd = new FormData();
        fd.append("file", file);
        try {
          const res = await http.upload<{ path: string }>("/v1/storage/files", fd);
          setImages((prev) => prev.map((it) =>
            it === pending[idx] ? { ...it, path: res.path, uploading: false } : it,
          ));
        } catch {
          toast.error(t("toast.failedUpload"), file.name);
          setImages((prev) => prev.map((it) =>
            it === pending[idx] ? { ...it, uploading: false, error: true } : it,
          ));
        }
      }),
    );
  };

  const removeImage = (idx: number) => {
    setImages((prev) => {
      const it = prev[idx];
      if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const updateTime = (idx: number, value: string) => {
    const ms = vnInputToMs(value);
    if (Number.isNaN(ms)) return;
    setTimes((prev) => prev.map((t, i) => (i === idx ? ms : t)));
  };
  const addTime = () => setTimes((prev) => [...prev, defaultNewTimeMs()]);
  const removeTime = (idx: number) => setTimes((prev) => prev.filter((_, i) => i !== idx));

  const validate = (): string => {
    const hasContent = message.trim() !== "" || images.some((i) => !i.uploading && !i.error && i.path);
    if (!hasContent) return t("form.requireContent");
    if (targets.length === 0) return t("form.requireTargets");
    const now = Date.now();
    if (times.filter((ms) => ms > now).length === 0) return t("form.requireTimes");
    return "";
  };

  const handleSave = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setSaving(true);
    try {
      const now = Date.now();
      await onSubmit({
        title: title.trim(),
        channel: channel.name,
        message: message.trim(),
        images: images.filter((i) => !i.uploading && !i.error && i.path).map((i) => i.path),
        targets,
        times: times.filter((ms) => ms > now),
      });
      onOpenChange(false);
    } catch {
      // toast already fired by the hook
    } finally {
      setSaving(false);
    }
  };

  const now = Date.now();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] flex flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 -mx-4 px-4 sm:-mx-6 sm:px-6 overflow-y-auto min-h-0">
          {/* Channel (read-only context) */}
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">{t("form.channel")}:</span>
            <span className="font-medium">{channel.display_name || channel.name}</span>
          </div>

          {/* Label */}
          <div className="space-y-1.5">
            <Label>{t("form.name")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("form.namePlaceholder")} />
          </div>

          {/* Content */}
          <div className="space-y-1.5">
            <Label>{t("form.content")}</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("form.contentPlaceholder")} rows={4} />
          </div>

          {/* Images */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4" /> {t("form.images")}
              <span className="text-xs font-normal text-muted-foreground">({t("form.maxImages")})</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {images.map((img, idx) => (
                <div key={idx} className="relative h-20 w-20 overflow-hidden rounded-md border bg-muted">
                  {img.previewUrl ? (
                    <img src={img.previewUrl} alt={img.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  {img.uploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    </div>
                  )}
                  {!img.uploading && !img.error && (
                    <div className="absolute bottom-0.5 right-0.5 rounded-full bg-green-600 p-0.5">
                      <Check className="h-3 w-3 text-white" />
                    </div>
                  )}
                  {img.error && (
                    <div className="absolute inset-0 flex items-center justify-center bg-destructive/70 text-[10px] text-white">!</div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeImage(idx)}
                    className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 hover:bg-black/80"
                  >
                    <X className="h-3 w-3 text-white" />
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground hover:border-primary hover:text-primary"
                >
                  <Upload className="h-5 w-5" />
                  <span className="text-[10px]">{t("form.addImages")}</span>
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.currentTarget.value = ""; }}
            />
          </div>

          {/* Targets */}
          <div className="space-y-1.5">
            <Label>{t("form.targets")}</Label>
            <p className="text-xs text-muted-foreground">{t("form.targetsHint")}</p>
            {targets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {targets.map((tg) => (
                  <Badge key={tg.id} variant="secondary" className="gap-1 pl-2">
                    {tg.type === "group" ? "👥" : "👤"} {tg.name || tg.id}
                    <button type="button" onClick={() => setTargets(targets.filter((x) => x.id !== tg.id))} className="ml-0.5 hover:opacity-70">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            {channel.channel_type === "zalo_personal" ? (
              <ZaloTargetPicker
                instanceId={channel.id}
                hasCredentials={channel.has_credentials}
                value={targets}
                onChange={setTargets}
              />
            ) : (
              <ManualTargetEntry onAdd={(tg) => { if (!targets.some((x) => x.id === tg.id)) setTargets([...targets, tg]); }} />
            )}
          </div>

          {/* Times */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> {t("form.times")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("form.timesHint")}</p>
            <div className="space-y-2">
              {times.map((ms, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    type="datetime-local"
                    value={msToVNInput(ms)}
                    onChange={(e) => updateTime(idx, e.target.value)}
                    className="text-base md:text-sm"
                  />
                  {ms <= now && <span className="shrink-0 text-xs text-destructive">{t("form.pastTime")}</span>}
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeTime(idx)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addTime} className="gap-1">
              <Plus className="h-4 w-4" /> {t("form.addTime")}
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("form.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving || uploading}>
            {saving ? t("form.saving") : t("form.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualTargetEntry({ onAdd }: { onAdd: (t: ScheduledMsgTarget) => void }) {
  const { t } = useTranslation("scheduled-messages");
  const [id, setId] = useState("");
  const [type, setType] = useState<"group" | "user">("group");
  return (
    <div className="flex items-center gap-2">
      <select
        value={type}
        onChange={(e) => setType(e.target.value as "group" | "user")}
        className="h-9 rounded-md border bg-background px-2 text-sm"
      >
        <option value="group">{t("form.tabGroups")}</option>
        <option value="user">{t("form.tabUsers")}</option>
      </select>
      <Input value={id} onChange={(e) => setId(e.target.value)} placeholder={t("form.manualId")} className="text-base md:text-sm" />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => { const v = id.trim(); if (v) { onAdd({ id: v, type, name: v }); setId(""); } }}
      >
        {t("form.add")}
      </Button>
    </div>
  );
}
