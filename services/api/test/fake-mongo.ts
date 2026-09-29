import mongoose from "mongoose";

/**
 * A small in-memory stand-in for the Mongoose models a test needs, with
 * enough of Mongo's query and update language to run real module code:
 * equality (ObjectIds and strings compare by value), $ne/$lt/$lte/$gt/$gte,
 * $in, $elemMatch, $type, $or/$and, $expr ($add, $lte); updates with $set,
 * $inc, $max, $push ($each, $slice), $setOnInsert and $pull (bare fields read as
 * $set, as Mongoose does); upserts; and unique
 * indexes that refuse a duplicate with Mongo's 11000.
 */

type Row = Record<string, any>;

const isOid = (v: unknown): v is mongoose.Types.ObjectId => v instanceof mongoose.Types.ObjectId;
const key = (v: unknown) => (v instanceof Date ? `d:${v.getTime()}` : v == null ? "null" : String(v));
const num = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v));

export function get(doc: Row, path: string): any {
  return path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), doc);
}

function setPath(doc: Row, path: string, value: unknown) {
  const parts = path.split(".");
  let o = doc;
  for (const p of parts.slice(0, -1)) {
    o[p] ??= {};
    o = o[p];
  }
  o[parts[parts.length - 1]!] = value;
}

function isOps(c: unknown): c is Row {
  return (
    Boolean(c) &&
    typeof c === "object" &&
    !Array.isArray(c) &&
    !(c instanceof Date) &&
    !isOid(c) &&
    Object.keys(c as Row).length > 0 &&
    Object.keys(c as Row).every((k) => k.startsWith("$"))
  );
}

function eq(a: unknown, b: unknown) {
  if (a == null || b == null) return a == null && b == null;
  return key(a) === key(b);
}

function matchValue(v: unknown, cond: unknown): boolean {
  if (isOps(cond)) {
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case "$ne":
          return Array.isArray(v) ? !v.some((x) => eq(x, arg)) : !eq(v, arg);
        case "$lt":
          return v != null && num(v) < num(arg);
        case "$lte":
          return v != null && num(v) <= num(arg);
        case "$gt":
          return v != null && num(v) > num(arg);
        case "$gte":
          return v != null && num(v) >= num(arg);
        case "$in":
          return (arg as unknown[]).some((a) => (Array.isArray(v) ? v.some((x) => eq(x, a)) : eq(v, a)));
        case "$nin":
          return !(arg as unknown[]).some((a) => (Array.isArray(v) ? v.some((x) => eq(x, a)) : eq(v, a)));
        case "$elemMatch":
          return Array.isArray(v) && v.some((x) => matches(x as Row, arg as Row));
        case "$type":
          return arg === "date" ? v instanceof Date : arg === "objectId" ? isOid(v) : typeof v === arg;
        default:
          throw new Error(`fake-mongo: no ${op}`);
      }
    });
  }
  if (Array.isArray(v) && !Array.isArray(cond)) return v.some((x) => eq(x, cond));
  return eq(v, cond);
}

function evalExpr(doc: Row, e: unknown): any {
  if (typeof e === "string" && e.startsWith("$")) return get(doc, e.slice(1));
  if (Array.isArray(e)) return e.map((x) => evalExpr(doc, x));
  if (e && typeof e === "object" && !(e instanceof Date)) {
    const [op, args] = Object.entries(e as Row)[0]!;
    const v = evalExpr(doc, args);
    switch (op) {
      case "$add":
        return (v as number[]).reduce((a, b) => a + b, 0);
      case "$lte":
        return v[0] <= v[1];
      default:
        throw new Error(`fake-mongo: no expression ${op}`);
    }
  }
  return e;
}

export function matches(doc: Row, filter: Row): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === "$or") return (cond as Row[]).some((f) => matches(doc, f));
    if (k === "$and") return (cond as Row[]).every((f) => matches(doc, f));
    if (k === "$expr") return Boolean(evalExpr(doc, cond));
    return matchValue(get(doc, k), cond);
  });
}

function applyUpdate(doc: Row, update: Row, inserting: boolean) {
  // Mongoose reads a bare field in an update as a $set.
  const bare = Object.entries(update).filter(([k]) => !k.startsWith("$"));
  if (bare.length) {
    update = Object.fromEntries(Object.entries(update).filter(([k]) => k.startsWith("$")));
    update.$set = { ...(update.$set as Row | undefined), ...Object.fromEntries(bare) };
  }
  for (const [op, fields] of Object.entries(update)) {
    if (op === "$set" || (op === "$setOnInsert" && inserting)) {
      for (const [k, v] of Object.entries(fields as Row)) setPath(doc, k, v);
    } else if (op === "$setOnInsert") {
      continue;
    } else if (op === "$inc") {
      for (const [k, v] of Object.entries(fields as Row)) setPath(doc, k, (get(doc, k) ?? 0) + (v as number));
    } else if (op === "$max") {
      for (const [k, v] of Object.entries(fields as Row)) {
        const cur = get(doc, k);
        if (cur == null || num(v) > num(cur)) setPath(doc, k, v);
      }
    } else if (op === "$min") {
      for (const [k, v] of Object.entries(fields as Row)) {
        const cur = get(doc, k);
        if (cur == null || num(v) < num(cur)) setPath(doc, k, v);
      }
    } else if (op === "$unset") {
      for (const k of Object.keys(fields as Row)) {
        const at = k.lastIndexOf(".");
        const parent = at < 0 ? doc : get(doc, k.slice(0, at));
        if (parent && typeof parent === "object") delete (parent as Row)[at < 0 ? k : k.slice(at + 1)];
      }
    } else if (op === "$push") {
      for (const [k, v] of Object.entries(fields as Row)) {
        const items: unknown[] = v && typeof v === "object" && "$each" in (v as Row) ? (v as Row).$each : [v];
        let next = [...(get(doc, k) ?? []), ...items];
        if (v && typeof v === "object" && typeof (v as Row).$slice === "number") next = next.slice((v as Row).$slice);
        setPath(doc, k, next);
      }
    } else if (op === "$pull") {
      for (const [k, cond] of Object.entries(fields as Row)) {
        const arr: unknown[] = get(doc, k) ?? [];
        setPath(
          doc,
          k,
          arr.filter((x) => !(cond && typeof cond === "object" && !isOps(cond) ? matches(x as Row, cond as Row) : matchValue(x, cond))),
        );
      }
    } else {
      throw new Error(`fake-mongo: no update ${op}`);
    }
  }
}

class Query<T> implements PromiseLike<T> {
  private opts: { sort?: Row; limit?: number } = {};
  constructor(private run: (opts: { sort?: Row; limit?: number }) => T) {}
  select() {
    return this;
  }
  lean() {
    return this;
  }
  populate() {
    return this;
  }
  sort(s: Row) {
    this.opts.sort = s;
    return this;
  }
  limit(n: number) {
    this.opts.limit = n;
    return this;
  }
  then<A = T, B = never>(onOk?: ((value: T) => A | PromiseLike<A>) | null, onErr?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return new Promise<T>((resolve) => resolve(this.run(this.opts))).then(onOk, onErr);
  }
  catch<B = never>(onErr: (reason: unknown) => B | PromiseLike<B>) {
    return this.then(undefined, onErr);
  }
}

type Unique = { keys: string[]; when?: (r: Row) => boolean };

export class FakeModel {
  rows: Row[] = [];
  constructor(
    public name: string,
    private unique: Unique[] = [],
  ) {}

  reset() {
    this.rows = [];
  }

  private attach(row: Row) {
    Object.defineProperty(row, "save", { value: async () => row, enumerable: false, configurable: true });
    return row;
  }

  private sorted(rows: Row[], sort?: Row) {
    if (!sort) return rows;
    const [[k, dir]] = Object.entries(sort) as [[string, number]];
    return [...rows].sort((a, b) => (num(get(a, k)) - num(get(b, k))) * dir);
  }

  private checkUnique(candidate: Row, except?: Row) {
    for (const u of this.unique) {
      if (u.when && !u.when(candidate)) continue;
      const clash = this.rows.find((r) => r !== except && (!u.when || u.when(r)) && u.keys.every((k) => eq(get(r, k), get(candidate, k))));
      if (clash) throw Object.assign(new Error(`E11000 duplicate key in ${this.name}`), { code: 11000 });
    }
  }

  /** Put a row straight in (for seeding). */
  insert(fields: Row) {
    const row = this.attach({ _id: new mongoose.Types.ObjectId(), createdAt: new Date(), updatedAt: new Date(), ...fields });
    this.checkUnique(row);
    this.rows.push(row);
    return row;
  }

  find(filter: Row = {}) {
    return new Query((o) => {
      let r = this.sorted(
        this.rows.filter((x) => matches(x, filter)),
        o.sort,
      );
      if (o.limit) r = r.slice(0, o.limit);
      return r;
    });
  }

  findOne(filter: Row = {}) {
    return new Query((o) => this.sorted(this.rows.filter((x) => matches(x, filter)), o.sort)[0] ?? null);
  }

  findById(id: unknown) {
    return this.findOne({ _id: id });
  }

  async exists(filter: Row) {
    const r = this.rows.find((x) => matches(x, filter));
    return r ? { _id: r._id } : null;
  }

  async countDocuments(filter: Row = {}) {
    return this.rows.filter((x) => matches(x, filter)).length;
  }

  async create(fields: Row) {
    return this.insert(fields);
  }

  async insertMany(list: Row[]) {
    const inserted: Row[] = [];
    let dup = false;
    for (const fields of list) {
      try {
        inserted.push(this.insert(fields));
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        dup = true;
      }
    }
    if (dup) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000, insertedDocs: inserted });
    return inserted;
  }

  async deleteOne(filter: Row) {
    const i = this.rows.findIndex((x) => matches(x, filter));
    if (i >= 0) this.rows.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }

  private upsertRow(filter: Row, update: Row) {
    const base: Row = {};
    for (const [k, v] of Object.entries(filter)) if (!k.startsWith("$") && !isOps(v)) setPath(base, k, v);
    const row: Row = { _id: new mongoose.Types.ObjectId(), createdAt: new Date(), updatedAt: new Date(), ...base };
    applyUpdate(row, update, true);
    this.checkUnique(row);
    this.attach(row);
    this.rows.push(row);
    return row;
  }

  private updateRow(row: Row, update: Row) {
    const before = { ...row };
    applyUpdate(row, update, false);
    try {
      this.checkUnique(row, row);
    } catch (error) {
      for (const k of Object.keys(row)) delete row[k];
      Object.assign(row, before);
      throw error;
    }
    row.updatedAt = new Date();
    return before;
  }

  async updateOne(filter: Row, update: Row, opts: Row = {}) {
    const row = this.rows.find((x) => matches(x, filter));
    if (!row) {
      if (opts.upsert) {
        this.upsertRow(filter, update);
        return { modifiedCount: 0, upsertedCount: 1, matchedCount: 0 };
      }
      return { modifiedCount: 0, upsertedCount: 0, matchedCount: 0 };
    }
    this.updateRow(row, update);
    return { modifiedCount: 1, upsertedCount: 0, matchedCount: 1 };
  }

  async updateMany(filter: Row, update: Row) {
    const rows = this.rows.filter((x) => matches(x, filter));
    for (const row of rows) this.updateRow(row, update);
    return { modifiedCount: rows.length };
  }

  findOneAndUpdate(filter: Row, update: Row, opts: Row = {}) {
    return new Query((o) => {
      const row = this.sorted(
        this.rows.filter((x) => matches(x, filter)),
        opts.sort ?? o.sort,
      )[0];
      if (!row) return opts.upsert ? this.upsertRow(filter, update) : null;
      const before = this.updateRow(row, update);
      return opts.new ? row : before;
    });
  }

  findByIdAndUpdate(id: unknown, update: Row, opts: Row = {}) {
    return this.findOneAndUpdate({ _id: id }, update, opts);
  }
}
