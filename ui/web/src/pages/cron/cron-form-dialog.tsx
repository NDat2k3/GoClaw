import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import type { CronCommandSpec, CronSchedule } from "./hooks/use-cron";
import { slugify } from "@/lib/slug";
import { useAgents } from "@/pages/agents/hooks/use-agents";
import { useChannels } from "@/pages/channels/hooks/use-channels";
import { ZaloContactsPicker } from "@/pages/channels/zalo/zalo-contacts-picker";
import { FileUploadDialog } from "@/components/shared/file-upload-dialog";
import { cronCreateSchema, type CronCreateFormData } from "@/schemas/cron.schema";

interface CronFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    name: string;
    schedule: CronSchedule;
    message?: string;
    command?: CronCommandSpec;
    staticMessage?: { message: string; images: string[]; targets: string[] };
    deliverChannel?: string;
    agentId?: string;
  }) => Promise<void>;
}

export function CronFormDialog({ open, onOpenChange, onSubmit }: CronFormDialogProps) {
  const { t } = useTranslation("cron");
  const { agents } = useAgents();
  const { channels } = useChannels();
  const [uploadingImages, setUploadingImages] = useState(false);

  const { register, control, handleSubmit, watch, setValue, reset, formState: { errors, isSubmitting } } = useForm<CronCreateFormData>({
    resolver: zodResolver(cronCreateSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      payloadKind: "agent_turn",
      message: "",
      commandArgvText: "sh\n-c\necho hello",
      commandCwd: "",
      commandTimeoutSeconds: "",
      commandNoOutputTimeoutSeconds: "",
      commandOutputMaxBytes: "",
      commandInput: "",
      staticMessageText: "",
      staticImages: [],
      staticTargetChannel: "",
      staticTargetGroups: [],
      agentId: "",
      scheduleKind: "every",
      everyValue: "60",
      cronExpr: "0 * * * *",
    },
  });

  const scheduleKind = watch("scheduleKind");
  const payloadKind = watch("payloadKind");
  const staticTargetChannel = watch("staticTargetChannel");
  const staticTargetGroups = watch("staticTargetGroups");
  const staticImages = watch("staticImages");

  const onFormSubmit = async (data: CronCreateFormData) => {
    let schedule: CronSchedule;
    if (data.scheduleKind === "every") {
      schedule = { kind: "every", everyMs: Number(data.everyValue) * 1000 };
    } else if (data.scheduleKind === "cron") {
      schedule = { kind: "cron", expr: data.cronExpr };
    } else {
      schedule = { kind: "at", atMs: Date.now() + 60000 };
    }

    const command = data.payloadKind === "command"
      ? {
        argv: (data.commandArgvText || "").split("\n").map((v) => v.trim()).filter(Boolean),
        cwd: data.commandCwd?.trim() || undefined,
        timeoutSeconds: data.commandTimeoutSeconds ? Number(data.commandTimeoutSeconds) : undefined,
        noOutputTimeoutSeconds: data.commandNoOutputTimeoutSeconds ? Number(data.commandNoOutputTimeoutSeconds) : undefined,
        outputMaxBytes: data.commandOutputMaxBytes ? Number(data.commandOutputMaxBytes) : undefined,
        input: data.commandInput || undefined,
      } satisfies CronCommandSpec
      : undefined;

    const staticMessage = data.payloadKind === "static_message"
      ? {
        message: data.staticMessageText || "",
        images: data.staticImages || [],
        targets: data.staticTargetGroups || [],
      }
      : undefined;

    await onSubmit({
      name: data.name,
      schedule,
      message: data.payloadKind === "agent_turn" ? data.message : undefined,
      command,
      staticMessage,
      deliverChannel: data.payloadKind === "static_message" ? data.staticTargetChannel : undefined,
      agentId: data.agentId || undefined,
    });
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 -mx-4 px-4 sm:-mx-6 sm:px-6 overflow-y-auto min-h-0">
          <div className="space-y-2">
            <Label>{t("create.name")}</Label>
            <Input
              {...register("name")}
              onChange={(e) => setValue("name", slugify(e.target.value), { shouldValidate: true })}
              placeholder={t("create.namePlaceholder")}
            />
            {errors.name ? (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t("create.nameHint")}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("create.agentId")}</Label>
            <Controller
              control={control}
              name="agentId"
              render={({ field }) => (
                <Select
                  value={field.value || "__default__"}
                  onValueChange={(v) => field.onChange(v === "__default__" ? "" : v)}
                >
                  <SelectTrigger className="text-base md:text-sm">
                    <SelectValue placeholder={t("create.agentIdPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">{t("create.agentIdPlaceholder")}</SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.display_name || a.agent_key || a.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>


          <div className="space-y-2">
            <Label>{t("create.payloadType")}</Label>
            <div className="flex flex-wrap gap-2">
              {(["agent_turn", "command", "static_message"] as const).map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  variant={payloadKind === kind ? "default" : "outline"}
                  size="sm"
                  onClick={() => setValue("payloadKind", kind, { shouldValidate: true })}
                >
                  {kind === "command" ? t("payload.command") : kind === "static_message" ? t("payload.staticMessage") : t("payload.agent")}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("create.scheduleType")}</Label>
            <div className="flex gap-2">
              {(["every", "cron", "at"] as const).map((kind) => (
                <Button
                  key={kind}
                  variant={scheduleKind === kind ? "default" : "outline"}
                  size="sm"
                  onClick={() => setValue("scheduleKind", kind)}
                >
                  {kind === "every" ? t("create.every") : kind === "cron" ? t("create.cron") : t("create.once")}
                </Button>
              ))}
            </div>
          </div>

          {scheduleKind === "every" && (
            <div className="space-y-2">
              <Label>{t("create.intervalSeconds")}</Label>
              <Input
                type="number"
                min={1}
                {...register("everyValue")}
                placeholder="60"
              />
            </div>
          )}

          {scheduleKind === "cron" && (
            <div className="space-y-2">
              <Label>{t("create.cronExpression")}</Label>
              <Input
                {...register("cronExpr")}
                placeholder="0 * * * *"
              />
              <p className="text-xs text-muted-foreground">{t("create.cronHint")}</p>
            </div>
          )}

          {scheduleKind === "at" && (
            <p className="text-sm text-muted-foreground">
              {t("create.onceDesc")}
            </p>
          )}

          {payloadKind === "agent_turn" && (
            <div className="space-y-2">
              <Label>{t("create.message")}</Label>
              <Textarea
                {...register("message")}
                placeholder={t("create.messagePlaceholder")}
                rows={3}
              />
              {errors.message && (
                <p className="text-xs text-destructive">{errors.message.message}</p>
              )}
            </div>
          )}

          {payloadKind === "command" && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-2">
                <Label>{t("detail.commandArgv")}</Label>
                <Textarea {...register("commandArgvText")} rows={4} className="font-mono text-base md:text-sm" />
                {errors.commandArgvText ? (
                  <p className="text-xs text-destructive">{errors.commandArgvText.message}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("detail.commandArgvHelp")}</p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("detail.commandCwd")}</Label>
                  <Input {...register("commandCwd")} placeholder={t("detail.defaultWorkingDirectory")} />
                </div>
                <div className="space-y-2">
                  <Label>{t("detail.commandTimeout")}</Label>
                  <Input type="number" min={0} {...register("commandTimeoutSeconds")} placeholder={t("detail.defaultValue")} />
                  {errors.commandTimeoutSeconds && <p className="text-xs text-destructive">{errors.commandTimeoutSeconds.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>{t("detail.commandNoOutputTimeout")}</Label>
                  <Input type="number" min={0} {...register("commandNoOutputTimeoutSeconds")} placeholder={t("detail.none")} />
                  {errors.commandNoOutputTimeoutSeconds && <p className="text-xs text-destructive">{errors.commandNoOutputTimeoutSeconds.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>{t("detail.commandOutputLimit")}</Label>
                  <Input type="number" min={0} {...register("commandOutputMaxBytes")} placeholder={t("detail.defaultValue")} />
                  {errors.commandOutputMaxBytes && <p className="text-xs text-destructive">{errors.commandOutputMaxBytes.message}</p>}
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("detail.commandInput")}</Label>
                <Textarea {...register("commandInput")} rows={3} className="font-mono text-base md:text-sm" placeholder={t("detail.none")} />
              </div>
            </div>
          )}

          {payloadKind === "static_message" && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-2">
                <Label>{t("create.targetChannel")}</Label>
                <Controller
                  control={control}
                  name="staticTargetChannel"
                  render={({ field }) => (
                    <Select value={field.value || ""} onValueChange={field.onChange}>
                      <SelectTrigger className="text-base md:text-sm">
                        <SelectValue placeholder={t("create.selectChannel")} />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(channels)
                          .filter(([, ch]) => ch.type === "zalo_personal")
                          .map(([name]) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.staticTargetChannel && (
                  <p className="text-xs text-destructive">{errors.staticTargetChannel.message}</p>
                )}
              </div>

              {staticTargetChannel && (
                <div className="space-y-2">
                  <Label>{t("create.targetGroups")}</Label>
                  <ZaloContactsPicker
                    instanceId={channels[staticTargetChannel]?.instance_id || ""}
                    hasCredentials={!!channels[staticTargetChannel]?.credentials_bound}
                    value={staticTargetGroups}
                    onChange={(groups) => setValue("staticTargetGroups", groups.map(g => g.groupId), { shouldValidate: true })}
                  />
                  {errors.staticTargetGroups && (
                    <p className="text-xs text-destructive">{errors.staticTargetGroups.message}</p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label>{t("create.message")} ({t("create.optional")})</Label>
                <Textarea
                  {...register("staticMessageText")}
                  placeholder={t("create.staticMessagePlaceholder")}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>{t("create.images")} ({t("create.optional")})</Label>
                <FileUploadDialog
                  accept=".jpg,.jpeg,.png,.gif,.webp"
                  maxSize={10 * 1024 * 1024}
                  onUpload={async (files) => {
                    setUploadingImages(true);
                    try {
                      const newUrls = await Promise.all(
                        Array.from(files).map(async (file) => {
                          const formData = new FormData();
                          formData.append("files", file);
                          const res = await fetch("/v1/storage/files", {
                            method: "POST",
                            body: formData,
                          });
                          const json = await res.json();
                          return json.paths?.[0] || "";
                        })
                      );
                      setValue("staticImages", [...(staticImages || []), ...newUrls.filter(Boolean)], { shouldValidate: true });
                    } finally {
                      setUploadingImages(false);
                    }
                  }}
                  isLoading={uploadingImages}
                />
                {staticImages && staticImages.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {staticImages.map((img, idx) => (
                      <Badge key={idx} variant="secondary" className="pl-2">
                        {img.split("/").pop() || `Image ${idx + 1}`}
                        <button
                          type="button"
                          onClick={() => setValue("staticImages", staticImages.filter((_, i) => i !== idx))}
                          className="ml-1 hover:opacity-70"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                {errors.staticImages && (
                  <p className="text-xs text-destructive">{errors.staticImages.message}</p>
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t("create.cancel")}
          </Button>
          <Button
            onClick={handleSubmit(onFormSubmit)}
            disabled={isSubmitting || !!errors.name || (
              payloadKind === "agent_turn" ? !!errors.message :
              payloadKind === "command" ? !!errors.commandArgvText :
              !!(errors.staticMessageText || errors.staticTargetChannel || errors.staticTargetGroups || errors.staticImages)
            )}
          >
            {isSubmitting ? t("create.creating") : t("create.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
