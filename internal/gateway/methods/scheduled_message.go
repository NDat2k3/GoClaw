package methods

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/nextlevelbuilder/goclaw/internal/bus"
	"github.com/nextlevelbuilder/goclaw/internal/config"
	"github.com/nextlevelbuilder/goclaw/internal/gateway"
	"github.com/nextlevelbuilder/goclaw/internal/i18n"
	"github.com/nextlevelbuilder/goclaw/internal/store"
	"github.com/nextlevelbuilder/goclaw/pkg/protocol"
)

// ScheduledMessageMethods implements the "Tin nhắn hẹn giờ" (scheduled messages)
// feature. It is a thin, friendly layer over the proven cron scheduler:
//
//   - One logical scheduled message = a Title + Channel + Content (text+images)
//     + Targets (groups/users) + a list of send datetimes.
//   - Each datetime becomes ONE cron job (Kind=static_message, Schedule=at,
//     delete_after_run=false) so the engine's atomic claim + fire-once logic is
//     reused as-is. Because the job is NOT deleted after firing, its last_status
//     / last_run_at double as the per-occurrence send history.
//   - All occurrence jobs of one message share a BatchID (stored in the payload),
//     so list/edit/delete operate on the whole message as a unit.
//
// No LLM is ever involved — the send handler (runStaticMessageCronJob) publishes
// directly to the outbound bus.
type ScheduledMessageMethods struct {
	service  store.CronStore
	eventBus bus.EventPublisher
	cfg      *config.Config
}

func NewScheduledMessageMethods(service store.CronStore, eventBus bus.EventPublisher, cfg *config.Config) *ScheduledMessageMethods {
	return &ScheduledMessageMethods{service: service, eventBus: eventBus, cfg: cfg}
}

func (m *ScheduledMessageMethods) Register(router *gateway.MethodRouter) {
	router.Register(protocol.MethodScheduledMsgList, m.handleList)
	router.Register(protocol.MethodScheduledMsgCreate, m.handleCreate)
	router.Register(protocol.MethodScheduledMsgUpdate, m.handleUpdate)
	router.Register(protocol.MethodScheduledMsgDelete, m.handleDelete)
}

// --- wire types (request/response) ---

type scheduledMsgTargetInput struct {
	ID   string `json:"id"`
	Type string `json:"type"` // "group" | "user"
	Name string `json:"name"`
}

type scheduledMsgOccurrence struct {
	JobID       string `json:"jobId"`
	TimeMs      int64  `json:"timeMs"`
	Status      string `json:"status"` // "pending" | "sent" | "error" | "disabled"
	LastRunAtMs *int64 `json:"lastRunAtMs,omitempty"`
	Error       string `json:"error,omitempty"`
	Enabled     bool   `json:"enabled"`
}

type scheduledMsgEntry struct {
	BatchID     string                    `json:"batchId"`
	Title       string                    `json:"title"`
	Channel     string                    `json:"channel"`
	Message     string                    `json:"message"`
	Images      []string                  `json:"images"`
	Targets     []scheduledMsgTargetInput `json:"targets"`
	Occurrences []scheduledMsgOccurrence  `json:"occurrences"`
	CreatedAtMs int64                     `json:"createdAtMs"`
	UpdatedAtMs int64                     `json:"updatedAtMs"`
}

// --- list ---

func (m *ScheduledMessageMethods) handleList(ctx context.Context, client *gateway.Client, req *protocol.RequestFrame) {
	userID := ""
	if !canSeeAll(client.Role(), m.cfg.Gateway.OwnerIDs, client.UserID()) {
		userID = client.UserID()
	}
	jobs := m.service.ListJobs(ctx, true, "", userID)

	byBatch := map[string]*scheduledMsgEntry{}
	var order []string
	for i := range jobs {
		j := jobs[i]
		if j.Payload.Kind != store.CronPayloadKindStaticMessage || j.Payload.StaticMessage == nil {
			continue
		}
		sm := j.Payload.StaticMessage
		bid := sm.BatchID
		if bid == "" {
			bid = j.ID // legacy / ungrouped fallback
		}

		entry := byBatch[bid]
		if entry == nil {
			entry = &scheduledMsgEntry{
				BatchID: bid,
				Title:   sm.Title,
				Channel: j.DeliverChannel,
				Message: sm.Message,
				Images:  sm.Images,
				Targets: buildTargetsView(sm),
			}
			byBatch[bid] = entry
			order = append(order, bid)
		}
		// Track the most recent content/timestamps across occurrences so an
		// edited message (future occurrences recreated with fresh content)
		// surfaces the latest title/message/images.
		if j.UpdatedAtMS > entry.UpdatedAtMs {
			entry.UpdatedAtMs = j.UpdatedAtMS
			entry.Title = sm.Title
			entry.Message = sm.Message
			entry.Images = sm.Images
			entry.Targets = buildTargetsView(sm)
		}
		if entry.CreatedAtMs == 0 || j.CreatedAtMS < entry.CreatedAtMs {
			entry.CreatedAtMs = j.CreatedAtMS
		}

		entry.Occurrences = append(entry.Occurrences, buildOccurrence(j))
	}

	entries := make([]scheduledMsgEntry, 0, len(order))
	for _, bid := range order {
		e := byBatch[bid]
		sort.Slice(e.Occurrences, func(a, b int) bool { return e.Occurrences[a].TimeMs < e.Occurrences[b].TimeMs })
		entries = append(entries, *e)
	}
	// Newest message first.
	sort.Slice(entries, func(a, b int) bool { return entries[a].CreatedAtMs > entries[b].CreatedAtMs })

	client.SendResponse(protocol.NewOKResponse(req.ID, map[string]any{"messages": entries}))
}

func buildTargetsView(sm *store.CronStaticMessageSpec) []scheduledMsgTargetInput {
	out := make([]scheduledMsgTargetInput, 0, len(sm.Targets))
	for i, id := range sm.Targets {
		t := scheduledMsgTargetInput{ID: id, Type: "group"}
		if i < len(sm.TargetTypes) && sm.TargetTypes[i] == "user" {
			t.Type = "user"
		}
		if i < len(sm.TargetNames) {
			t.Name = sm.TargetNames[i]
		}
		out = append(out, t)
	}
	return out
}

func buildOccurrence(j store.CronJob) scheduledMsgOccurrence {
	occ := scheduledMsgOccurrence{JobID: j.ID, Enabled: j.Enabled}
	// Occurrence time: prefer the scheduled "at" time, then next/last run.
	switch {
	case j.Schedule.AtMS != nil:
		occ.TimeMs = *j.Schedule.AtMS
	case j.State.NextRunAtMS != nil:
		occ.TimeMs = *j.State.NextRunAtMS
	case j.State.LastRunAtMS != nil:
		occ.TimeMs = *j.State.LastRunAtMS
	}
	occ.LastRunAtMs = j.State.LastRunAtMS
	if j.State.LastError != "" {
		occ.Error = j.State.LastError
	}
	switch {
	case j.State.LastRunAtMS != nil && j.State.LastStatus == "ok":
		occ.Status = "sent"
	case j.State.LastRunAtMS != nil && j.State.LastStatus != "":
		occ.Status = "error"
	case !j.Enabled:
		occ.Status = "disabled"
	default:
		occ.Status = "pending"
	}
	return occ
}

// --- create ---

type scheduledMsgCreateParams struct {
	Title   string                    `json:"title"`
	Channel string                    `json:"channel"`
	Message string                    `json:"message"`
	Images  []string                  `json:"images"` // relative (fresh upload) or absolute (edit round-trip) paths
	Targets []scheduledMsgTargetInput `json:"targets"`
	Times   []int64                   `json:"times"` // epoch ms; one occurrence job per entry
}

func (m *ScheduledMessageMethods) handleCreate(ctx context.Context, client *gateway.Client, req *protocol.RequestFrame) {
	locale := store.LocaleFromContext(ctx)
	var params scheduledMsgCreateParams
	if req.Params != nil {
		json.Unmarshal(req.Params, &params)
	}

	batchID := uuid.Must(uuid.NewV7()).String()
	created, err := m.createOccurrences(ctx, client, batchID, params)
	if err != nil {
		client.SendResponse(protocol.NewErrorResponse(req.ID, protocol.ErrInvalidRequest, err.Error()))
		return
	}
	if created == 0 {
		client.SendResponse(protocol.NewErrorResponse(req.ID, protocol.ErrInvalidRequest, i18n.T(locale, i18n.MsgRequired, "times")))
		return
	}

	client.SendResponse(protocol.NewOKResponse(req.ID, map[string]any{
		"batchId": batchID,
		"created": created,
	}))
	emitAudit(m.eventBus, client, "scheduledmsg.created", "scheduledmsg", batchID)
}

// createOccurrences validates the input, resolves image paths to absolute local
// paths, and creates one static-message cron job per future send time. It is
// shared by create and update (update reuses an existing BatchID).
func (m *ScheduledMessageMethods) createOccurrences(ctx context.Context, client *gateway.Client, batchID string, params scheduledMsgCreateParams) (int, error) {
	if strings.TrimSpace(params.Channel) == "" {
		return 0, fmt.Errorf("channel is required")
	}
	if len(params.Targets) == 0 {
		return 0, fmt.Errorf("at least one target (group or user) is required")
	}

	absImages, err := m.resolveImagePaths(ctx, params.Images)
	if err != nil {
		return 0, err
	}

	ids := make([]string, 0, len(params.Targets))
	types := make([]string, 0, len(params.Targets))
	names := make([]string, 0, len(params.Targets))
	for _, t := range params.Targets {
		if strings.TrimSpace(t.ID) == "" {
			return 0, fmt.Errorf("a target is missing its id")
		}
		ids = append(ids, t.ID)
		if t.Type == "user" {
			types = append(types, "user")
		} else {
			types = append(types, "group")
		}
		names = append(names, t.Name)
	}

	spec := &store.CronStaticMessageSpec{
		Message:     params.Message,
		Images:      absImages,
		Targets:     ids,
		TargetTypes: types,
		TargetNames: names,
		Title:       params.Title,
		BatchID:     batchID,
	}
	if err := store.ValidateCronStaticMessageSpec(spec); err != nil {
		return 0, err
	}

	// Only schedule times that are still in the future — a past "at" time would
	// never fire and would just linger as a dead row.
	nowMs := time.Now().UnixMilli()
	shortBatch := strings.ReplaceAll(batchID, "-", "")
	if len(shortBatch) > 8 {
		shortBatch = shortBatch[:8]
	}

	falseVal := false
	trueVal := true
	created := 0
	for _, t := range params.Times {
		if t <= nowMs {
			continue
		}
		at := t
		name := fmt.Sprintf("smsg-%s-%d", shortBatch, t)
		sched := store.CronSchedule{Kind: "at", AtMS: &at}

		job, err := m.service.AddJob(ctx, name, sched, "", true, params.Channel, "", "", client.UserID())
		if err != nil {
			return created, fmt.Errorf("create occurrence: %w", err)
		}
		if job == nil {
			return created, fmt.Errorf("occurrence created but could not be loaded")
		}

		patch := store.CronJobPatch{
			StaticMessage:  spec,
			DeleteAfterRun: &falseVal, // keep as history after firing
			Deliver:        &trueVal,
			DeliverChannel: &params.Channel,
			Stateless:      &trueVal,
		}
		updateCtx := store.WithTenantID(ctx, job.TenantID)
		if _, pErr := m.service.UpdateJob(updateCtx, job.ID, patch); pErr != nil {
			return created, fmt.Errorf("configure occurrence: %w", pErr)
		}
		created++
	}
	return created, nil
}

// resolveImagePaths turns each frontend-supplied image reference into an
// absolute local path the outbound Zalo sender can os.ReadFile. Fresh uploads
// arrive as paths relative to the tenant data dir (what POST /v1/storage/files
// returns); edit round-trips may already be absolute. Both are validated to sit
// inside the tenant data dir (no path traversal) and to exist on disk.
func (m *ScheduledMessageMethods) resolveImagePaths(ctx context.Context, refs []string) ([]string, error) {
	if len(refs) == 0 {
		return nil, nil
	}
	base := config.TenantDataDir(m.cfg.WorkspacePath(), store.TenantIDFromContext(ctx), store.TenantSlugFromContext(ctx))
	if !filepath.IsAbs(base) {
		if absBase, err := filepath.Abs(base); err == nil {
			base = absBase
		}
	}
	base = filepath.Clean(base)

	out := make([]string, 0, len(refs))
	for _, ref := range refs {
		clean := filepath.Clean(strings.TrimSpace(ref))
		if clean == "" {
			continue
		}
		var abs string
		if filepath.IsAbs(clean) {
			abs = clean
		} else {
			abs = filepath.Join(base, clean)
		}
		rel, err := filepath.Rel(base, abs)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("invalid image path: %s", ref)
		}
		info, err := os.Stat(abs)
		if err != nil || info.IsDir() {
			return nil, fmt.Errorf("image not found or unreadable: %s", ref)
		}
		out = append(out, abs)
	}
	return out, nil
}

// --- update (edit) ---

func (m *ScheduledMessageMethods) handleUpdate(ctx context.Context, client *gateway.Client, req *protocol.RequestFrame) {
	locale := store.LocaleFromContext(ctx)
	var params struct {
		BatchID string `json:"batchId"`
		scheduledMsgCreateParams
	}
	if req.Params != nil {
		json.Unmarshal(req.Params, &params)
	}
	if params.BatchID == "" {
		client.SendResponse(protocol.NewErrorResponse(req.ID, protocol.ErrInvalidRequest, i18n.T(locale, i18n.MsgRequired, "batchId")))
		return
	}

	batchJobs, allowed := m.collectBatch(ctx, client, params.BatchID)
	if !allowed {
		client.SendResponse(protocol.NewErrorResponse(req.ID, protocol.ErrUnauthorized, i18n.T(locale, i18n.MsgPermissionDenied, "scheduled message")))
		return
	}
	if len(batchJobs) == 0 {
		client.SendResponse(protocol.NewErrorResponse(req.ID, protocol.ErrNotFound, i18n.T(locale, i18n.MsgJobNotFound)))
		return
	}

	// Delete only the pending (not-yet-fired) occurrences; keep already-sent ones
	// as history. A never-run occurrence has no last_run timestamp.
	for _, j := range batchJobs {
		if j.State.LastRunAtMS == nil {
			if err := m.service.RemoveJob(ctx, j.ID); err != nil {
				client.SendResponse(protocol.NewErrorResponse(req.ID, protocol.ErrInternal, err.Error()))
				return
			}
		}
	}

	created, err := m.createOccurrences(ctx, client, params.BatchID, params.scheduledMsgCreateParams)
	if err != nil {
		client.SendResponse(protocol.NewErrorResponse(req.ID, protocol.ErrInvalidRequest, err.Error()))
		return
	}

	client.SendResponse(protocol.NewOKResponse(req.ID, map[string]any{
		"batchId": params.BatchID,
		"created": created,
	}))
	emitAudit(m.eventBus, client, "scheduledmsg.updated", "scheduledmsg", params.BatchID)
}

// --- delete ---

func (m *ScheduledMessageMethods) handleDelete(ctx context.Context, client *gateway.Client, req *protocol.RequestFrame) {
	locale := store.LocaleFromContext(ctx)
	var params struct {
		BatchID string `json:"batchId"`
	}
	if req.Params != nil {
		json.Unmarshal(req.Params, &params)
	}
	if params.BatchID == "" {
		client.SendResponse(protocol.NewErrorResponse(req.ID, protocol.ErrInvalidRequest, i18n.T(locale, i18n.MsgRequired, "batchId")))
		return
	}

	batchJobs, allowed := m.collectBatch(ctx, client, params.BatchID)
	if !allowed {
		client.SendResponse(protocol.NewErrorResponse(req.ID, protocol.ErrUnauthorized, i18n.T(locale, i18n.MsgPermissionDenied, "scheduled message")))
		return
	}
	if len(batchJobs) == 0 {
		client.SendResponse(protocol.NewErrorResponse(req.ID, protocol.ErrNotFound, i18n.T(locale, i18n.MsgJobNotFound)))
		return
	}

	deleted := 0
	for _, j := range batchJobs {
		if err := m.service.RemoveJob(ctx, j.ID); err == nil {
			deleted++
		}
	}

	client.SendResponse(protocol.NewOKResponse(req.ID, map[string]any{"deleted": deleted}))
	emitAudit(m.eventBus, client, "scheduledmsg.deleted", "scheduledmsg", params.BatchID)
}

// collectBatch returns all occurrence jobs for a batch and whether the caller is
// allowed to mutate them (owner sees all; otherwise must own every occurrence).
func (m *ScheduledMessageMethods) collectBatch(ctx context.Context, client *gateway.Client, batchID string) ([]store.CronJob, bool) {
	jobs := m.service.ListJobs(ctx, true, "", "")
	seeAll := canSeeAll(client.Role(), m.cfg.Gateway.OwnerIDs, client.UserID())
	var out []store.CronJob
	for i := range jobs {
		j := jobs[i]
		if j.Payload.Kind != store.CronPayloadKindStaticMessage || j.Payload.StaticMessage == nil {
			continue
		}
		bid := j.Payload.StaticMessage.BatchID
		if bid == "" {
			bid = j.ID
		}
		if bid != batchID {
			continue
		}
		if !seeAll && j.UserID != client.UserID() {
			return nil, false
		}
		out = append(out, j)
	}
	return out, true
}
