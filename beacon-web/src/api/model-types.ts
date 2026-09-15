// UI adapters normalize selected optional wire fields to explicit nulls.
// Keys and value types stay tied to the generated contract.
export type NullableFields<T, K extends keyof T> = Omit<T, K> & {
  [P in K]-?: Exclude<T[P], undefined> | null;
};
