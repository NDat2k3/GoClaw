import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import i18next from "i18next";
import { useWs } from "@/hooks/use-ws";
import { useAuthStore } from "@/stores/use-auth-store";
import { Methods } from "@/api/protocol";
import { toast } from "@/stores/use-toast-store";

export type ScheduledMsgTargetType = "group" | "user";

export interface ScheduledMsgTarget {
  id: string;
  type: ScheduledMsgTargetType;
  name: string;
}

export type ScheduledMsgStatus = "pending" | "sent" | "error" | "disabled";

export interface ScheduledMsgOccurrence {
  jobId: string;
  timeMs: number;
  status: ScheduledMsgStatus;
  lastRunAtMs?: number;
  error?: string;
  enabled: boolean;
}

export interface ScheduledMessage {
  batchId: string;
  title: string;
  channel: string;
  message: string;
  images: string[];
  targets: ScheduledMsgTarget[];
  occurrences: ScheduledMsgOccurrence[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ScheduledMsgInput {
  title: string;
  channel: string;
  message: string;
  images: string[];
  targets: ScheduledMsgTarget[];
  times: number[];
}

const queryKey = ["scheduled-messages"] as const;

export function useScheduledMessages() {
  const ws = useWs();
  const connected = useAuthStore((s) => s.connected);
  const queryClient = useQueryClient();

  const { data: messages = [], isPending: loading, isFetching: refreshing } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await ws.call<{ messages: ScheduledMessage[] }>(Methods.SCHEDULED_MSG_LIST, {});
      return res.messages ?? [];
    },
    staleTime: 30_000,
    enabled: connected,
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient],
  );

  const createMessage = useCallback(
    async (input: ScheduledMsgInput) => {
      try {
        await ws.call(Methods.SCHEDULED_MSG_CREATE, input as unknown as Record<string, unknown>);
        await invalidate();
        toast.success(i18next.t("scheduled-messages:toast.created"));
      } catch (err) {
        toast.error(i18next.t("scheduled-messages:toast.failedCreate"), err instanceof Error ? err.message : "");
        throw err;
      }
    },
    [ws, invalidate],
  );

  const updateMessage = useCallback(
    async (batchId: string, input: ScheduledMsgInput) => {
      try {
        await ws.call(Methods.SCHEDULED_MSG_UPDATE, { batchId, ...input } as unknown as Record<string, unknown>);
        await invalidate();
        toast.success(i18next.t("scheduled-messages:toast.updated"));
      } catch (err) {
        toast.error(i18next.t("scheduled-messages:toast.failedUpdate"), err instanceof Error ? err.message : "");
        throw err;
      }
    },
    [ws, invalidate],
  );

  const deleteMessage = useCallback(
    async (batchId: string) => {
      try {
        await ws.call(Methods.SCHEDULED_MSG_DELETE, { batchId });
        await invalidate();
        toast.success(i18next.t("scheduled-messages:toast.deleted"));
      } catch (err) {
        toast.error(i18next.t("scheduled-messages:toast.failedDelete"), err instanceof Error ? err.message : "");
        throw err;
      }
    },
    [ws, invalidate],
  );

  return { messages, loading, refreshing, refresh: invalidate, createMessage, updateMessage, deleteMessage };
}
