"use client";

import { useMemo, useState } from "react";
import { createPerson, normalize, type Person } from "@/lib/people";
import {
  addRelationship, updateRelationship, otherId, roleFor,
  RELATIONSHIP_TYPES, RELATIONSHIP_LABEL,
  type Relationship, type RelationshipType,
} from "@/lib/relationships";
import { BUTTON_PRIMARY, BUTTON_SECONDARY_CARD } from "@/lib/ui";

interface RelationshipEditorProps {
  selfId: string;
  /** The profile-page owner's name — "self" here means whichever person's
   *  page this editor was opened from, not the app's own single user, and
   *  the role labels below need that name spelled out to avoid reading as
   *  a first-person "my." */
  selfName: string;
  people: Person[];
  editing?: Relationship;
  onSaved: () => void;
  onCancel: () => void;
}

const ROLE_TYPES: RelationshipType[] = ["kin", "introduced"];

export default function RelationshipEditor({ selfId, selfName, people, editing, onSaved, onCancel }: RelationshipEditorProps) {
  const directory = useMemo(() => people.filter((p) => p.id !== selfId), [people, selfId]);

  const editingOtherId = editing ? otherId(editing, selfId) : undefined;
  const editingRoles = editing ? roleFor(editing, selfId) : { selfRole: undefined, otherRole: undefined };

  const [query, setQuery] = useState(
    editingOtherId ? directory.find((p) => p.id === editingOtherId)?.name ?? "" : ""
  );
  const [chosenId, setChosenId] = useState<string | undefined>(editingOtherId);
  const [type, setType] = useState<RelationshipType>(editing?.type ?? "kin");
  const [otherRole, setOtherRole] = useState(editingRoles.otherRole ?? "");
  const [selfRole, setSelfRole] = useState(editingRoles.selfRole ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = normalize(query);
    if (!q || chosenId) return [];
    return directory
      .filter((p) => [p.name, ...p.aliases].some((n) => normalize(n).includes(q)))
      .slice(0, 6);
  }, [query, chosenId, directory]);

  // Names the two role fields by the actual people involved instead of
  // "my"/"their" — "my" would otherwise misread as the app's single user
  // rather than whichever profile this editor was opened from.
  const otherName = (chosenId ? directory.find((p) => p.id === chosenId)?.name : query.trim()) || undefined;
  const otherRoleLabel = otherName ? `${otherName}'s role` : "The other person's role";
  const selfRoleLabel = `${selfName}'s role`;

  const showRoles = ROLE_TYPES.includes(type);
  const canCreate = query.trim().length > 0 && !chosenId && matches.length === 0;

  const save = () => {
    setError(null);
    let targetId = chosenId;
    if (!targetId) {
      if (!canCreate) {
        setError("Pick a person, or type a new name to create.");
        return;
      }
      const created = createPerson({ name: query.trim() });
      if (!created) {
        setError("Could not create that person (name empty or storage full).");
        return;
      }
      targetId = created.id;
    }
    if (editing) {
      // updateRelationship stores roles by a/b orientation, so map the
      // editor's self/other roles onto whichever side `selfId` occupies.
      const oriented = editing.aId === selfId
        ? { aRole: showRoles ? selfRole : undefined, bRole: showRoles ? otherRole : undefined }
        : { aRole: showRoles ? otherRole : undefined, bRole: showRoles ? selfRole : undefined };
      const ok = updateRelationship(editing.id, { type, note, ...oriented });
      if (!ok) { setError("Could not save the change."); return; }
    } else {
      const rel = addRelationship({
        aId: selfId, bId: targetId, type,
        aRole: showRoles ? selfRole : undefined,
        bRole: showRoles ? otherRole : undefined,
        note,
      });
      if (!rel) { setError("Could not save the relationship."); return; }
    }
    onSaved();
  };

  return (
    <div className="enter-rise card p-4 border-cyan-500/30 mt-3">
      <label className="block text-sm text-slate-400 mb-1">Person</label>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setChosenId(undefined); }}
        placeholder="Search a person, or type a new name…"
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]"
        disabled={!!editing}
      />
      {matches.length > 0 && (
        <ul className="mt-1 space-y-1">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => { setChosenId(p.id); setQuery(p.name); }}
                className="w-full text-left text-sm text-slate-200 px-3 py-2 min-h-[44px] rounded-lg hover:bg-slate-700 transition-colors"
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <p className="text-xs text-slate-400 mt-1">
          No match — saving will create “{query.trim()}” and link them.
        </p>
      )}

      <div className="mt-3">
        <span className="block text-sm text-slate-400 mb-1">Type</span>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Relationship type">
          {RELATIONSHIP_TYPES.map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={`px-4 py-2 min-h-[44px] rounded-full text-sm transition-colors ${
                // Detector cross-pairs mutually-exclusive ternary branches. Real pairs, both AA-clear:
                // slate-950 on cyan-400 = 11.16:1; slate-300 on slate-800 = 8.59:1.
                type === t ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300 hover:text-white" // impeccable-disable-line gray-on-color
              }`}
            >
              {RELATIONSHIP_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {showRoles && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm text-slate-400 mb-1 truncate" title={otherRoleLabel}>{otherRoleLabel}</label>
            <input value={otherRole} onChange={(e) => setOtherRole(e.target.value)} placeholder="e.g. daughter"
              aria-label={otherRoleLabel}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]" />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1 truncate" title={selfRoleLabel}>{selfRoleLabel}</label>
            <input value={selfRole} onChange={(e) => setSelfRole(e.target.value)} placeholder="e.g. father"
              aria-label={selfRoleLabel}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]" />
          </div>
        </div>
      )}

      <div className="mt-3">
        <label className="block text-sm text-slate-400 mb-1">Note (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. leases her east pasture"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]" />
      </div>

      {error && <p className="text-sm text-red-400 mt-2" role="alert">{error}</p>}

      <div className="flex gap-2 mt-4">
        <button onClick={save} className={`${BUTTON_PRIMARY} py-2 px-5`}>
          {editing ? "Save" : "Add relationship"}
        </button>
        <button onClick={onCancel} className={BUTTON_SECONDARY_CARD}>Cancel</button>
      </div>
    </div>
  );
}
