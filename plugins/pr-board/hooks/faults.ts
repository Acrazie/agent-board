// A band Client that failed is drawn with its Button instead, but only while the
// code that failed is still the one loaded: each record carries the load it was
// heard in, and a record from an earlier load is ignored, since a reload is what
// gives a failed Client its next try.

/** The record of `element` failing during `load`. */
const recordOf = (load: string, element: string) => `${load} ${element}`

/** The records with `element` added for `load`; records of other loads are dropped. */
export const withFault = (records: readonly string[], load: string, element: string): string[] => {
  const current = records.filter(record => record.startsWith(`${load} `))
  const record = recordOf(load, element)
  return current.includes(record) ? current : [...current, record]
}

/** Whether `element` failed during `load`. */
export const isFaulted = (records: readonly string[], load: string, element: string) => records.includes(recordOf(load, element))

/** The records without `element` for `load`: its Client gets drawn again. */
export const withoutFault = (records: readonly string[], load: string, element: string): string[] =>
  records.filter(record => record !== recordOf(load, element))
