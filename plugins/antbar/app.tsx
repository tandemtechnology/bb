// AntBar — frontend entry.
//
// Surfaces:
//  - an attention Inbox above the project and group hierarchy;
//  - a "Groups" nav panel: a kanban board of the current project's threads
//    bucketed into user-defined groups (+ an Ungrouped column), with
//    drag-and-drop assignment;
//  - a thread-side "Group" panel tab for filing the open thread;
//  - a single sidebar provider for Inbox → Project → Group → Thread.
//
// Data flows over RPC (see ./server contract) and refreshes live via
// useRealtime("board:<projectId>"). Style with host theme tokens only.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@bb/plugin-sdk/app";
import type {
  PluginSidebarThread,
  PluginThreadListProps,
} from "@bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon, type IconName } from "@/components/ui/icon";
import { projectInbox, sortThreads, threadTitle } from "./inbox";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

// Narrow row shapes derived from the contract output (kept local).
interface Group {
  id: string;
  projectId: string;
  name: string;
  color: string;
  emoji: string;
  position: number;
  createdAt: number;
}
interface ThreadCard {
  id: string;
  title: string;
  status: string;
  updatedAt: number;
}
interface Column {
  groupId: string | null;
  threads: ThreadCard[];
}
interface BoardData {
  groups: Group[];
  columns: Column[];
}

const groupLabel = (group: Group) =>
  `${group.emoji ? group.emoji + " " : ""}${group.name}`;

// --------------------------------------------------------------------------
// Board data hook — fetch + realtime refetch (mirrors github/app.tsx useItems)
// --------------------------------------------------------------------------

function useBoard(projectId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!projectId) {
      setData(null);
      setError(null);
      return;
    }
    rpc.call("listBoard", { projectId }).then(
      (result) => {
        setData(result as BoardData);
        setError(null);
      },
      (err: unknown) => {
        setData(null);
        setError(err instanceof Error ? err.message : String(err));
      },
    );
  }, [rpc, projectId]);

  useEffect(() => {
    refetch();
  }, [refetch]);
  // Channel is stable per project; "board:none" is a harmless no-op subscription.
  useRealtime(`board:${projectId ?? "none"}`, refetch);

  return { data, error, refetch, rpc };
}

// Shared by the assign tab and the header chip: the project's groups + this
// thread's current group, with an optimistic assign.
function useThreadGroup(threadId: string, projectId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    Promise.all([
      rpc.call("listBoard", { projectId }),
      rpc.call("threadGroup", { threadId }),
    ]).then(
      ([board, tg]) => {
        setGroups((board as BoardData).groups);
        setCurrent((tg as { groupId: string | null }).groupId);
        setError(null);
      },
      (err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
    );
  }, [rpc, projectId, threadId]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime(`board:${projectId ?? "none"}`, load);

  const assign = useCallback(
    (groupId: string | null) => {
      if (!projectId) return;
      setCurrent(groupId); // optimistic; realtime/load reconciles
      void rpc
        .call("assignThread", { threadId, projectId, groupId })
        .then(load);
    },
    [rpc, projectId, threadId, load],
  );

  return { groups, current, error, assign };
}

// Optimistically move a card to a target column, for snappy drag-and-drop.
function optimisticMove(
  board: BoardData,
  threadId: string,
  toGroupId: string | null,
): BoardData {
  let moved: ThreadCard | null = null;
  const stripped = board.columns.map((column) => {
    const keep: ThreadCard[] = [];
    for (const card of column.threads) {
      if (card.id === threadId) moved = card;
      else keep.push(card);
    }
    return { ...column, threads: keep };
  });
  if (!moved) return board;
  const columns = stripped.map((column) =>
    column.groupId === toGroupId
      ? { ...column, threads: [moved as ThreadCard, ...column.threads] }
      : column,
  );
  return { ...board, columns };
}

// --------------------------------------------------------------------------
// Status dot
// --------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const running = status === "active" || status === "starting";
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span
        className={
          "size-1.5 rounded-full " +
          (status === "error"
            ? "bg-destructive"
            : running
              ? "bg-primary"
              : "bg-muted-foreground/50")
        }
        aria-hidden
      />
      {status}
    </span>
  );
}

// --------------------------------------------------------------------------
// Thread card (draggable) with a "move to group" picker
// --------------------------------------------------------------------------

function ThreadCardView({
  card,
  currentGroupId,
  groups,
  onAssign,
  onDragStateChange,
}: {
  card: ThreadCard;
  currentGroupId: string | null;
  groups: Group[];
  onAssign: (threadId: string, groupId: string | null) => void;
  onDragStateChange: (dragging: boolean) => void;
}) {
  const navigate = useBbNavigate();
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStateChange(true);
      }}
      onDragEnd={() => onDragStateChange(false)}
      className="group cursor-grab rounded-md border border-border bg-background p-2.5 shadow-sm active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => navigate.toThread(card.id)}
          className="min-w-0 flex-1 text-left text-sm font-medium text-foreground hover:underline"
        >
          <span className="line-clamp-2">{card.title}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-6 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label="Move thread to group"
            >
              ⋯
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {groups.map((group) => (
              <DropdownMenuItem
                key={group.id}
                disabled={group.id === currentGroupId}
                onSelect={() => onAssign(card.id, group.id)}
              >
                {groupLabel(group)}
              </DropdownMenuItem>
            ))}
            {currentGroupId !== null ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onAssign(card.id, null)}>
                  Remove from group
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-1.5">
        <StatusBadge status={card.status} />
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Column (drop target)
// --------------------------------------------------------------------------

function BoardColumn({
  column,
  group,
  groups,
  isDropTarget,
  onAssign,
  onEdit,
  onDelete,
  onDragStateChange,
  onDropCard,
  onDragOverColumn,
}: {
  column: Column;
  group: Group | null;
  groups: Group[];
  isDropTarget: boolean;
  onAssign: (threadId: string, groupId: string | null) => void;
  onEdit: (group: Group) => void;
  onDelete: (group: Group) => void;
  onDragStateChange: (dragging: boolean) => void;
  onDropCard: (threadId: string, toGroupId: string | null) => void;
  onDragOverColumn: (groupId: string | null) => void;
}) {
  const title = group ? groupLabel(group) : "Ungrouped";
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOverColumn(column.groupId);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const threadId = e.dataTransfer.getData("text/plain");
        if (threadId) onDropCard(threadId, column.groupId);
      }}
      className={
        "flex w-72 shrink-0 flex-col rounded-lg p-2 transition-colors " +
        (isDropTarget ? "bg-state-active ring-2 ring-primary/50" : "bg-card/50")
      }
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex min-w-0 items-center gap-2">
          {group && group.color ? (
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: group.color }}
              aria-hidden
            />
          ) : null}
          <span className="truncate text-sm font-semibold text-foreground">
            {title}
          </span>
          <span className="text-xs text-muted-foreground">
            {column.threads.length}
          </span>
        </div>
        {group ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                aria-label={`Manage group ${group.name}`}
              >
                ⋯
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEdit(group)}>
                Rename / edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => onDelete(group)}
              >
                Delete group
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="flex min-h-16 flex-col gap-2 overflow-y-auto">
        {column.threads.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            {isDropTarget ? "Drop to assign" : "No threads"}
          </p>
        ) : (
          column.threads.map((card) => (
            <ThreadCardView
              key={card.id}
              card={card}
              currentGroupId={column.groupId}
              groups={groups}
              onAssign={onAssign}
              onDragStateChange={onDragStateChange}
            />
          ))
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Create / edit group dialog
// --------------------------------------------------------------------------

type EditState = { mode: "create" } | { mode: "edit"; group: Group } | null;

function GroupDialog({
  state,
  projectId,
  rpc,
  onClose,
}: {
  state: EditState;
  projectId: string;
  rpc: Rpc;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [color, setColor] = useState("");

  useEffect(() => {
    if (state?.mode === "edit") {
      setName(state.group.name);
      setEmoji(state.group.emoji);
      setColor(state.group.color);
    } else if (state?.mode === "create") {
      setName("");
      setEmoji("");
      setColor("");
    }
  }, [state]);

  const open = state !== null;
  const submit = () => {
    if (!name.trim()) return;
    if (state?.mode === "edit") {
      void rpc
        .call("renameGroup", {
          groupId: state.group.id,
          name: name.trim(),
          emoji,
          color,
        })
        .then(onClose);
    } else {
      void rpc
        .call("createGroup", { projectId, name: name.trim(), emoji, color })
        .then(onClose);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state?.mode === "edit" ? "Edit group" : "New group"}
          </DialogTitle>
          <DialogDescription>
            Groups organize this project's threads. A thread belongs to one
            group at a time.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              placeholder="🚧"
              className="w-16 text-center"
              aria-label="Emoji"
            />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
              aria-label="Group name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="Color (e.g. #4f46e5) — optional"
              aria-label="Color"
            />
            {color ? (
              <span
                className="size-6 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: color }}
                aria-hidden
              />
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim()}>
            {state?.mode === "edit" ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------
// Board nav panel
// --------------------------------------------------------------------------

function Board() {
  const { projectId } = useBbContext();
  const { data, error, rpc } = useBoard(projectId);
  const [edit, setEdit] = useState<EditState>(null);
  // Local optimistic copy: reset to server truth on every fetch, mutated on drop.
  const [board, setBoard] = useState<BoardData | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    setBoard(data);
  }, [data]);

  const groupById = useMemo(
    () => new Map((board?.groups ?? []).map((g) => [g.id, g])),
    [board],
  );

  const assign = useCallback(
    (threadId: string, groupId: string | null) => {
      if (!projectId) return;
      setBoard((prev) =>
        prev ? optimisticMove(prev, threadId, groupId) : prev,
      );
      void rpc.call("assignThread", { threadId, projectId, groupId });
    },
    [rpc, projectId],
  );

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        Select a project to see its thread groups.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <p className="text-sm text-muted-foreground">
          {board
            ? `${board.groups.length} group${board.groups.length === 1 ? "" : "s"}`
            : "Loading…"}
        </p>
        <Button size="sm" onClick={() => setEdit({ mode: "create" })}>
          + New group
        </Button>
      </div>

      {error ? (
        <p className="p-4 text-sm text-destructive">{error}</p>
      ) : !board ? (
        <p className="p-4 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div
          className="flex flex-1 gap-3 overflow-x-auto p-3"
          onDragLeave={() => setDragOver(null)}
        >
          {board.columns.map((column) => (
            <BoardColumn
              key={column.groupId ?? "__ungrouped__"}
              column={column}
              group={
                column.groupId ? (groupById.get(column.groupId) ?? null) : null
              }
              groups={board.groups}
              isDropTarget={dragging && dragOver === column.groupId}
              onAssign={assign}
              onEdit={(group) => setEdit({ mode: "edit", group })}
              onDelete={(group) => {
                void rpc.call("deleteGroup", { groupId: group.id });
              }}
              onDragStateChange={setDragging}
              onDropCard={(threadId, toGroupId) => {
                setDragging(false);
                setDragOver(null);
                assign(threadId, toGroupId);
              }}
              onDragOverColumn={setDragOver}
            />
          ))}
          {board.groups.length === 0 ? (
            <div className="flex w-72 shrink-0 items-center justify-center rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              No groups yet. Create one to start organizing threads.
            </div>
          ) : null}
        </div>
      )}

      <GroupDialog
        state={edit}
        projectId={projectId}
        rpc={rpc}
        onClose={() => setEdit(null)}
      />
    </div>
  );
}

// --------------------------------------------------------------------------
// Thread-side "Group" assign tab
// --------------------------------------------------------------------------

function AssignTab({ threadId }: { threadId: string }) {
  const { projectId } = useBbContext();
  const { groups, current, error, assign } = useThreadGroup(
    threadId,
    projectId,
  );

  if (!projectId) {
    return (
      <p className="text-sm text-muted-foreground">
        This thread is not in a project.
      </p>
    );
  }
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!groups) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Assign this thread to a group:
      </p>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No groups yet. Create one in the Groups panel.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {groups.map((group) => {
            const selected = group.id === current;
            return (
              <Button
                key={group.id}
                variant={selected ? "default" : "outline"}
                className="justify-start"
                onClick={() => assign(selected ? null : group.id)}
              >
                <span className="mr-2">{group.emoji || "•"}</span>
                {group.name}
                {selected ? <span className="ml-auto">✓</span> : null}
              </Button>
            );
          })}
          {current !== null ? (
            <Button
              variant="ghost"
              className="justify-start text-muted-foreground"
              onClick={() => assign(null)}
            >
              Remove from group
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// AntBar sidebar: Inbox → Project → Group → Thread
// --------------------------------------------------------------------------

// Mirrors bb's native ThreadStatusGlyph mapping (icon + tone) with tokens the
// plugin Tailwind build is guaranteed to emit. animate-shine-icon is bb-only,
// so working states use the standard animate-pulse.
const SHINE = "animate-pulse text-muted-foreground/60";
const STATUS_GLYPH: Partial<
  Record<
    PluginSidebarThread["indicator"],
    { icon: IconName; className: string }
  >
> = {
  "unread-error": { icon: "CircleX", className: "text-destructive" },
  "waiting-for-input": {
    icon: "CircleQuestion",
    className: "text-muted-foreground/75",
  },
  runtime: {
    icon: "Loading",
    className: "animate-spin text-muted-foreground/60",
  },
  workflow: { icon: "Workflow", className: SHINE },
  "background-agent": { icon: "UserRoundPlus", className: SHINE },
  "background-command": { icon: "Terminal", className: SHINE },
  "plan-mode": { icon: "ListTodo", className: SHINE },
  goal: { icon: "Target", className: SHINE },
  draft: { icon: "Edit", className: "text-muted-foreground" },
  "working-draft": { icon: "Edit", className: SHINE },
};

function StatusGlyph({
  thread,
  needsInput = false,
}: {
  thread: PluginSidebarThread;
  needsInput?: boolean;
}) {
  if (needsInput) {
    return (
      <Icon
        name="CircleQuestion"
        className="size-4 text-primary"
        aria-label={thread.indicatorLabel ?? "Thread needs your input"}
      />
    );
  }

  const label = thread.indicatorLabel ?? undefined;
  const mapped = STATUS_GLYPH[thread.indicator];
  if (mapped) {
    return (
      <Icon
        name={mapped.icon}
        className={`size-4 ${mapped.className}`}
        aria-label={label}
      />
    );
  }
  if (thread.indicator === "unread-success" || thread.isUnread) {
    return (
      <span
        className="size-1.5 rounded-full bg-foreground/70"
        aria-label={label ?? "Unread"}
      />
    );
  }
  return null;
}

function SidebarRow({
  thread,
  active,
  projectName,
  needsInput = false,
  canonicalKeyboardTarget = true,
  projectGroups,
  currentGroupId,
  actions,
  onAssign,
  onNavigate,
  onDragStart,
  onDragEnd,
}: {
  thread: PluginSidebarThread;
  active: boolean;
  projectName?: string;
  needsInput?: boolean;
  canonicalKeyboardTarget?: boolean;
  projectGroups: Group[];
  currentGroupId: string | null;
  actions: ReturnType<typeof experimental_useSidebarThreadActions>;
  onAssign: (
    threadId: string,
    projectId: string,
    groupId: string | null,
  ) => void;
  onNavigate: () => void;
  onDragStart: (threadId: string, projectId: string) => void;
  onDragEnd: () => void;
}) {
  const open = () => {
    actions.open(thread.id);
    onNavigate();
  };
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/x-bb-thread",
          JSON.stringify({ threadId: thread.id, projectId: thread.projectId }),
        );
        e.dataTransfer.effectAllowed = "move";
        onDragStart(thread.id, thread.projectId);
      }}
      onDragEnd={onDragEnd}
      className={
        "group/row flex h-7 cursor-grab items-center rounded-md text-sm transition-colors active:cursor-grabbing " +
        (active
          ? "bg-state-active text-foreground"
          : "text-foreground/85 hover:bg-state-hover")
      }
    >
      {/* The grouped copy owns the keyboard DOM contract. */}
      <a
        data-sidebar-thread-shortcut-target={
          canonicalKeyboardTarget ? "" : undefined
        }
        data-sidebar-thread-id={canonicalKeyboardTarget ? thread.id : undefined}
        tabIndex={0}
        role="button"
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-7 pr-1 outline-none"
        title={threadTitle(thread)}
      >
        {thread.isPinned ? (
          <Icon
            name="Pin"
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{threadTitle(thread)}</span>
        {projectName ? (
          <span className="max-w-20 shrink-0 truncate text-xs text-muted-foreground">
            {projectName}
          </span>
        ) : null}
      </a>
      <div className="flex shrink-0 items-center gap-0.5 pr-1">
        <span className="flex size-4 items-center justify-center group-hover/row:hidden">
          <StatusGlyph thread={thread} needsInput={needsInput} />
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="hidden size-5 shrink-0 group-hover/row:flex data-[state=open]:flex"
              aria-label="Thread actions"
            >
              <Icon name="MoreHorizontal" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
            <DropdownMenuItem
              onSelect={() => {
                actions.open(thread.id, { split: true });
                onNavigate();
              }}
            >
              Open in split
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                void actions.setPinned(thread.id, !thread.isPinned)
              }
            >
              {thread.isPinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void actions.setRead(thread.id, thread.isUnread)}
            >
              {thread.isUnread ? "Mark read" : "Mark unread"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {projectGroups.length === 0 ? (
              <DropdownMenuItem disabled>
                No groups in this project
              </DropdownMenuItem>
            ) : (
              projectGroups.map((group) => (
                <DropdownMenuItem
                  key={group.id}
                  disabled={group.id === currentGroupId}
                  onSelect={() =>
                    onAssign(thread.id, thread.projectId, group.id)
                  }
                >
                  Move to {groupLabel(group)}
                </DropdownMenuItem>
              ))
            )}
            {currentGroupId !== null ? (
              <DropdownMenuItem
                onSelect={() => onAssign(thread.id, thread.projectId, null)}
              >
                Remove from group
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.archive(thread.id)}>
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => actions.requestDelete(thread.id)}
            >
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function CollapseHeader({
  collapsed,
  onToggle,
  children,
  count,
  padClass,
  emphasis,
  onNewThread,
  onNewGroup,
}: {
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  count: number;
  padClass: string;
  emphasis?: boolean;
  onNewThread?: () => void;
  onNewGroup?: () => void;
}) {
  const hasMenu = Boolean(onNewThread || onNewGroup);
  return (
    <div className="group/hdr flex h-7 items-center rounded-md pr-1 hover:bg-state-hover">
      <button
        type="button"
        onClick={onToggle}
        className={`flex h-full min-w-0 flex-1 items-center gap-1 text-left ${padClass}`}
      >
        <Icon
          name="ChevronRight"
          className={
            "size-3 shrink-0 text-muted-foreground transition-transform " +
            (collapsed ? "" : "rotate-90")
          }
          aria-hidden
        />
        <span
          className={
            "truncate text-xs " +
            (emphasis
              ? "font-medium text-foreground/80"
              : "font-normal text-muted-foreground")
          }
        >
          {children}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground/60">
          {count}
        </span>
      </button>
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-5 shrink-0 opacity-0 group-hover/hdr:opacity-100 data-[state=open]:opacity-100"
              aria-label="Add"
            >
              <Icon name="Plus" className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onNewThread ? (
              <DropdownMenuItem onSelect={onNewThread}>
                New thread
              </DropdownMenuItem>
            ) : null}
            {onNewGroup ? (
              <DropdownMenuItem onSelect={onNewGroup}>
                New group
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

const COLLAPSE_KEY = "bb-plugin-antbar:collapsed";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsed(set: Set<string>) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage may be unavailable; collapse state is best-effort.
  }
}

function AntBarSidebar({
  activeThreadId,
  onNavigate,
  searchQuery,
}: PluginThreadListProps) {
  const { status, threads, projects } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const rpc = useRpc<typeof rpcContract>();

  const [groups, setGroups] = useState<Group[]>([]);
  const [membership, setMembership] = useState<Map<string, string>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    loadCollapsed(),
  );
  // Drag-to-group state.
  const [drag, setDrag] = useState<{
    threadId: string;
    projectId: string;
  } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  // Create-group dialog: the project id it targets, or null when closed.
  const [newGroupProject, setNewGroupProject] = useState<string | null>(null);

  const load = useCallback(() => {
    rpc.call("allGroups", null).then((res) => {
      const data = res as {
        groups: Group[];
        membership: { threadId: string; groupId: string }[];
      };
      setGroups(data.groups);
      setMembership(
        new Map(data.membership.map((m) => [m.threadId, m.groupId])),
      );
    });
  }, [rpc]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime("antbar:groups-changed", load);

  const assign = useCallback(
    (threadId: string, projectId: string, groupId: string | null) => {
      setMembership((prev) => {
        const next = new Map(prev);
        if (groupId === null) next.delete(threadId);
        else next.set(threadId, groupId);
        return next;
      });
      void rpc.call("assignThread", { threadId, projectId, groupId });
    },
    [rpc],
  );

  const query = searchQuery.trim().toLowerCase();
  const searching = query.length > 0;
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsed(next);
      return next;
    });

  const endDrag = () => {
    setDrag(null);
    setDragOverKey(null);
  };

  const model = useMemo(() => {
    const inbox = projectInbox(threads, query);
    const groupsByProject = new Map<string, Group[]>();
    for (const g of groups) {
      const list = groupsByProject.get(g.projectId) ?? [];
      list.push(g);
      groupsByProject.set(g.projectId, list);
    }
    const threadsByProject = new Map<string, PluginSidebarThread[]>();
    for (const t of inbox.grouped) {
      const list = threadsByProject.get(t.projectId) ?? [];
      list.push(t);
      threadsByProject.set(t.projectId, list);
    }
    return { groupsByProject, threadsByProject, inbox: inbox.inbox };
  }, [groups, threads, query]);

  if (status === "loading") {
    return (
      <p className="p-3 text-sm text-muted-foreground">Loading threads…</p>
    );
  }
  if (status === "error") {
    return (
      <p className="p-3 text-sm text-destructive">Failed to load threads.</p>
    );
  }

  const visibleProjects = projects.filter(
    (p) => (model.threadsByProject.get(p.id) ?? []).length > 0,
  );

  const projectsById = new Map(
    projects.map((project) => [project.id, project]),
  );

  return (
    <>
      <div className="flex flex-col gap-2 px-2 py-2">
        <section
          aria-labelledby="antbar-inbox-heading"
          className="rounded-lg border border-primary/30 bg-primary/10 p-1"
        >
          <div className="flex h-7 items-center gap-1.5 px-2">
            <Icon name="Mail" className="size-4 text-primary" aria-hidden />
            <h2
              id="antbar-inbox-heading"
              className="min-w-0 flex-1 truncate text-sm font-medium"
            >
              Inbox
            </h2>
            <span
              className="min-w-5 rounded-full bg-primary/15 px-1.5 text-center text-xs font-medium text-primary"
              aria-label={`${model.inbox.length} threads need your attention`}
            >
              {model.inbox.length}
            </span>
          </div>
          {model.inbox.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {searching
                ? "No matching threads need your attention."
                : "Nothing needs your attention."}
            </p>
          ) : (
            <div className="flex flex-col">
              {model.inbox.map((thread) => {
                const project = projectsById.get(thread.projectId);
                return (
                  <SidebarRow
                    key={thread.id}
                    thread={thread}
                    active={thread.id === activeThreadId}
                    projectName={
                      project?.isPersonal ? "Personal" : project?.name
                    }
                    needsInput={thread.hasPendingInteraction}
                    canonicalKeyboardTarget={false}
                    projectGroups={
                      model.groupsByProject.get(thread.projectId) ?? []
                    }
                    currentGroupId={membership.get(thread.id) ?? null}
                    actions={actions}
                    onAssign={assign}
                    onNavigate={onNavigate}
                    onDragStart={(threadId, projectId) =>
                      setDrag({ threadId, projectId })
                    }
                    onDragEnd={endDrag}
                  />
                );
              })}
            </div>
          )}
        </section>

        {visibleProjects.length === 0 && model.inbox.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            {searching ? "No threads match your search." : "No threads yet."}
          </p>
        ) : null}
        {visibleProjects.map((project) => {
          const projectThreads = model.threadsByProject.get(project.id) ?? [];
          const projectGroups = model.groupsByProject.get(project.id) ?? [];
          const byGroup = new Map<string | null, PluginSidebarThread[]>();
          for (const g of projectGroups) byGroup.set(g.id, []);
          byGroup.set(null, []);
          for (const t of projectThreads) {
            const gid = membership.get(t.id) ?? null;
            const key = gid && byGroup.has(gid) ? gid : null;
            byGroup.get(key)!.push(t);
          }

          const projectKey = `proj:${project.id}`;
          const projectCollapsed = !searching && collapsed.has(projectKey);

          // Ordered sections: defined groups (even empty, so they show as
          // drop targets) + Ungrouped last.
          const sections: { id: string | null; group: Group | null }[] = [
            ...projectGroups.map((g) => ({
              id: g.id as string | null,
              group: g,
            })),
            { id: null, group: null },
          ];

          return (
            <div key={project.id}>
              <CollapseHeader
                collapsed={projectCollapsed}
                onToggle={() => toggle(projectKey)}
                count={projectThreads.length}
                padClass="pl-2"
                emphasis
                onNewThread={() =>
                  actions.openNewThread({ projectId: project.id })
                }
                onNewGroup={() => setNewGroupProject(project.id)}
              >
                {project.isPersonal ? "Personal" : project.name}
              </CollapseHeader>

              {projectCollapsed
                ? null
                : sections.map((section) => {
                    const rows = (byGroup.get(section.id) ?? [])
                      .slice()
                      .sort(sortThreads);
                    // Hide Ungrouped only when there's nothing to show AND no
                    // groups exist to drop out of.
                    if (
                      section.id === null &&
                      rows.length === 0 &&
                      projectGroups.length === 0
                    ) {
                      return null;
                    }
                    const groupKey = `grp:${project.id}:${section.id ?? "ungrouped"}`;
                    const groupCollapsed =
                      !searching && collapsed.has(groupKey);
                    const label = section.group
                      ? groupLabel(section.group)
                      : "Ungrouped";
                    const canDrop = drag?.projectId === project.id;
                    const isDropTarget = canDrop && dragOverKey === groupKey;
                    return (
                      <div
                        key={groupKey}
                        className={
                          "rounded-md " +
                          (isDropTarget
                            ? "bg-state-active ring-1 ring-primary/40"
                            : "")
                        }
                        onDragOver={(e) => {
                          if (!canDrop) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDragOverKey(groupKey);
                        }}
                        onDrop={(e) => {
                          if (!canDrop || !drag) return;
                          e.preventDefault();
                          assign(drag.threadId, project.id, section.id);
                          endDrag();
                        }}
                      >
                        <CollapseHeader
                          collapsed={groupCollapsed}
                          onToggle={() => toggle(groupKey)}
                          count={rows.length}
                          padClass="pl-4"
                        >
                          {label}
                        </CollapseHeader>
                        {groupCollapsed ? null : (
                          <div className="flex flex-col">
                            {rows.length === 0 ? (
                              <p className="py-1 pl-7 text-xs text-muted-foreground/60">
                                {isDropTarget ? "Drop to assign" : "—"}
                              </p>
                            ) : (
                              rows.map((t) => (
                                <SidebarRow
                                  key={t.id}
                                  thread={t}
                                  active={t.id === activeThreadId}
                                  projectGroups={projectGroups}
                                  currentGroupId={membership.get(t.id) ?? null}
                                  actions={actions}
                                  onAssign={assign}
                                  onNavigate={onNavigate}
                                  onDragStart={(threadId, projectId) =>
                                    setDrag({ threadId, projectId })
                                  }
                                  onDragEnd={endDrag}
                                />
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
            </div>
          );
        })}
      </div>

      <GroupDialog
        state={newGroupProject ? { mode: "create" } : null}
        projectId={newGroupProject ?? ""}
        rpc={rpc}
        onClose={() => setNewGroupProject(null)}
      />
    </>
  );
}

// --------------------------------------------------------------------------

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "board",
    title: "Groups",
    icon: "Columns",
    path: "groups",
    component: Board,
  });
  app.slots.threadPanelAction({
    id: "assign",
    title: "Group",
    icon: "Columns",
    component: AssignTab,
  });
  app.slots.experimental_threadList({
    id: "antbar",
    title: "AntBar",
    description: "Attention Inbox, then threads nested by project and group.",
    component: AntBarSidebar,
  });
});
