type SortDirection = 1 | -1;

type SortSpec = Record<string, SortDirection>;

type GenericObject = Record<string, any>;

function clone<T>(value: T): T {
	return structuredClone(value);
}

function getValueByPath(source: GenericObject, path: string): any {
	const parts = path.split(".");
	let current: any = source;
	for (const part of parts) {
		if (current == null) return undefined;
		current = current[part];
	}
	return current;
}

function setValueByPath(target: GenericObject, path: string, value: any): void {
	const parts = path.split(".");
	let current: any = target;
	for (let i = 0; i < parts.length - 1; i++) {
		const key = parts[i];
		if (!current[key] || typeof current[key] !== "object") {
			current[key] = {};
		}
		current = current[key];
	}
	current[parts[parts.length - 1]] = value;
}

function deleteByPath(target: GenericObject, path: string): void {
	const parts = path.split(".");
	let current: any = target;
	for (let i = 0; i < parts.length - 1; i++) {
		if (!current || typeof current !== "object") return;
		current = current[parts[i]];
	}
	if (current && typeof current === "object") {
		delete current[parts[parts.length - 1]];
	}
}

function isOperatorObject(value: any): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	return Object.keys(value).some((key) => key.startsWith("$"));
}

function compareValue(a: any, b: any): boolean {
	if (a instanceof Date && b instanceof Date) {
		return a.getTime() === b.getTime();
	}
	return a === b;
}

export function matchesFilter(item: GenericObject, filter: GenericObject = {}): boolean {
	if (!filter || Object.keys(filter).length === 0) return true;

	if (Array.isArray(filter.$or)) {
		const orMatches = filter.$or.some((subFilter: GenericObject) =>
			matchesFilter(item, subFilter),
		);
		if (!orMatches) return false;
	}

	for (const [key, expected] of Object.entries(filter)) {
		if (key === "$or") continue;

		const actual = getValueByPath(item, key);

		if (isOperatorObject(expected)) {
			for (const [operator, operand] of Object.entries(expected)) {
				if (operator === "$ne") {
					if (compareValue(actual, operand)) return false;
					continue;
				}

				if (operator === "$exists") {
					const exists = actual !== undefined;
					if (Boolean(operand) !== exists) return false;
					continue;
				}

				if (operator === "$gte") {
					if (!(actual >= operand)) return false;
					continue;
				}

				if (operator === "$lte") {
					if (!(actual <= operand)) return false;
					continue;
				}
			}
			continue;
		}

		if (!compareValue(actual, expected)) {
			return false;
		}
	}

	return true;
}

function applySort<T extends GenericObject>(items: T[], sortSpec?: SortSpec): T[] {
	if (!sortSpec || Object.keys(sortSpec).length === 0) return items;
	const [[field, direction]] = Object.entries(sortSpec) as [string, SortDirection][];
	return [...items].sort((a, b) => {
		const av = getValueByPath(a, field);
		const bv = getValueByPath(b, field);
		if (av == null && bv == null) return 0;
		if (av == null) return 1;
		if (bv == null) return -1;
		if (av > bv) return direction;
		if (av < bv) return -direction;
		return 0;
	});
}

function applySelect(item: GenericObject, selectFields?: string[]): GenericObject {
	if (!selectFields || selectFields.length === 0) return item;
	const selected: GenericObject = {};
	for (const field of selectFields) {
		selected[field] = getValueByPath(item, field);
	}
	return selected;
}

export function applyUpdate(item: GenericObject, update: GenericObject): GenericObject {
	const next = clone(item);

	for (const [key, value] of Object.entries(update || {})) {
		if (key === "$inc" && value && typeof value === "object") {
			for (const [incPath, incValue] of Object.entries(value)) {
				const current = Number(getValueByPath(next, incPath) || 0);
				setValueByPath(next, incPath, current + Number(incValue));
			}
			continue;
		}

		if (key === "$unset" && value && typeof value === "object") {
			for (const unsetPath of Object.keys(value)) {
				deleteByPath(next, unsetPath);
			}
			continue;
		}

		setValueByPath(next, key, value);
	}

	return next;
}

function resolveGroupValue(item: GenericObject, groupId: any): any {
	if (typeof groupId === "string" && groupId.startsWith("$")) {
		return getValueByPath(item, groupId.slice(1));
	}
	return groupId;
}

export function runAggregate(items: GenericObject[], pipeline: any[]): GenericObject[] {
	let current = [...items];

	for (const stage of pipeline || []) {
		if (stage.$match) {
			current = current.filter((item) => matchesFilter(item, stage.$match));
			continue;
		}

		if (stage.$group) {
			const groupSpec = stage.$group;
			const groups = new Map<any, GenericObject>();

			for (const item of current) {
				const groupKey = resolveGroupValue(item, groupSpec._id);
				if (!groups.has(groupKey)) {
					groups.set(groupKey, { _id: groupKey });
				}
				const target = groups.get(groupKey)!;

				for (const [field, accSpec] of Object.entries(groupSpec)) {
					if (field === "_id") continue;
					if (
						accSpec &&
						typeof accSpec === "object" &&
						"$sum" in (accSpec as GenericObject)
					) {
						const sumOperand = (accSpec as GenericObject).$sum;
						const addValue =
							typeof sumOperand === "string" && sumOperand.startsWith("$") ?
								Number(getValueByPath(item, sumOperand.slice(1)) || 0)
							: Number(sumOperand || 0);
						target[field] = Number(target[field] || 0) + addValue;
					}
				}
			}

			current = Array.from(groups.values());
			continue;
		}

		if (stage.$sort) {
			current = applySort(current, stage.$sort);
			continue;
		}

		if (stage.$limit) {
			current = current.slice(0, Number(stage.$limit));
		}
	}

	return current;
}

export class MemoryQuery<TDoc> implements PromiseLike<any> {
	private sortSpec?: SortSpec;
	private limitCount?: number;
	private selectFields?: string[];
	private leanEnabled = false;

	constructor(
		private readonly getItems: () => GenericObject[] | Promise<GenericObject[]>,
		private readonly mode: "one" | "many",
		private readonly hydrate: (item: GenericObject) => TDoc,
	) {}

	sort(spec: SortSpec): this {
		this.sortSpec = spec;
		return this;
	}

	limit(count: number): this {
		this.limitCount = count;
		return this;
	}

	select(selection: string): this {
		this.selectFields = selection
			.split(" ")
			.map((field) => field.trim())
			.filter(Boolean);
		return this;
	}

	lean(): this {
		this.leanEnabled = true;
		return this;
	}

	private format(item: GenericObject): any {
		const selected = applySelect(item, this.selectFields);
		return this.leanEnabled ? clone(selected) : this.hydrate(selected);
	}

	async exec(): Promise<any> {
		const sourceItems = await this.getItems();
		let items = sourceItems.map((item) => clone(item));
		items = applySort(items, this.sortSpec);
		if (typeof this.limitCount === "number") {
			items = items.slice(0, this.limitCount);
		}

		if (this.mode === "one") {
			const first = items[0];
			if (!first) return null;
			return this.format(first);
		}

		return items.map((item) => this.format(item));
	}

	then<TResult1 = any, TResult2 = never>(
		onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
		onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
	): Promise<TResult1 | TResult2> {
		return this.exec().then(onfulfilled, onrejected);
	}

	catch<TResult = never>(
		onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
	): Promise<any | TResult> {
		return this.exec().catch(onrejected);
	}

	finally(onfinally?: (() => void) | null): Promise<any> {
		return this.exec().finally(onfinally);
	}
}

export function createId(prefix: string): string {
	const rand = Math.random().toString(36).slice(2, 10);
	return `${prefix}_${Date.now()}_${rand}`;
}
