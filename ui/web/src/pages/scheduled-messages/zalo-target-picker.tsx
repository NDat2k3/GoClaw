import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Users, User, Check, Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWsCall } from "@/hooks/use-ws-call";
import { toast } from "@/stores/use-toast-store";
import type { ScheduledMsgTarget } from "./hooks/use-scheduled-messages";

interface ZaloFriend {
  userId: string;
  displayName: string;
  zaloName?: string;
}
interface ZaloGroup {
  groupId: string;
  name: string;
  totalMember: number;
}
interface ContactsResult {
  friends: ZaloFriend[];
  groups: ZaloGroup[];
}

interface ZaloTargetPickerProps {
  instanceId: string;
  hasCredentials: boolean;
  value: ScheduledMsgTarget[];
  onChange: (targets: ScheduledMsgTarget[]) => void;
}

/**
 * Live group/friend multi-select backed by the zalo.personal.contacts RPC.
 * Returns full {id, type, name} targets so the backend can route each one to
 * the correct Zalo thread (group vs 1:1). Refetches whenever the channel
 * instance changes so a stale account's IDs can never leak into another.
 */
export function ZaloTargetPicker({ instanceId, hasCredentials, value, onChange }: ZaloTargetPickerProps) {
  const { t } = useTranslation("scheduled-messages");
  const [contacts, setContacts] = useState<ContactsResult | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"group" | "user">("group");
  const { loading, call: fetchContacts } = useWsCall<ContactsResult>("zalo.personal.contacts");
  const loadedFor = useRef<string>("");

  useEffect(() => {
    if (!hasCredentials || !instanceId) return;
    if (loadedFor.current === instanceId) return;
    loadedFor.current = instanceId;
    fetchContacts({ instance_id: instanceId })
      .then(setContacts)
      .catch(() => toast.error(t("toast.failedLoadGroups")));
  }, [instanceId, hasCredentials, fetchContacts, t]);

  const selectedIds = new Set(value.map((v) => v.id));

  const toggle = (target: ScheduledMsgTarget) => {
    if (selectedIds.has(target.id)) {
      onChange(value.filter((v) => v.id !== target.id));
    } else {
      onChange([...value, target]);
    }
  };

  const q = search.trim().toLowerCase();
  const groups = (contacts?.groups ?? []).filter((g) => !q || g.name.toLowerCase().includes(q));
  const friends = (contacts?.friends ?? []).filter(
    (f) => !q || f.displayName.toLowerCase().includes(q) || (f.zaloName ?? "").toLowerCase().includes(q),
  );

  return (
    <div className="space-y-2">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "group" | "user")}>
        <TabsList className="w-full">
          <TabsTrigger value="group" className="flex-1 gap-1">
            <Users className="h-3.5 w-3.5" /> {t("form.tabGroups")} ({contacts?.groups?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="user" className="flex-1 gap-1">
            <User className="h-3.5 w-3.5" /> {t("form.tabUsers")} ({contacts?.friends?.length ?? 0})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("form.searchTargets")}
          className="pl-8 text-base md:text-sm"
        />
      </div>

      <div className="max-h-52 overflow-y-auto rounded-md border">
        {loading && (
          <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
          </div>
        )}
        {!loading && tab === "group" && groups.map((g) => {
          const target: ScheduledMsgTarget = { id: g.groupId, type: "group", name: g.name };
          const active = selectedIds.has(g.groupId);
          return (
            <button
              key={g.groupId}
              type="button"
              onClick={() => toggle(target)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${active ? "bg-accent/60" : ""}`}
            >
              <span className={`flex h-4 w-4 items-center justify-center rounded border ${active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                {active && <Check className="h-3 w-3" />}
              </span>
              <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{g.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{g.totalMember}</span>
            </button>
          );
        })}
        {!loading && tab === "user" && friends.map((f) => {
          const target: ScheduledMsgTarget = { id: f.userId, type: "user", name: f.displayName };
          const active = selectedIds.has(f.userId);
          return (
            <button
              key={f.userId}
              type="button"
              onClick={() => toggle(target)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${active ? "bg-accent/60" : ""}`}
            >
              <span className={`flex h-4 w-4 items-center justify-center rounded border ${active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                {active && <Check className="h-3 w-3" />}
              </span>
              <User className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{f.displayName}</span>
            </button>
          );
        })}
        {!loading && ((tab === "group" && groups.length === 0) || (tab === "user" && friends.length === 0)) && (
          <div className="p-4 text-center text-sm text-muted-foreground">—</div>
        )}
      </div>
    </div>
  );
}
