import { useState, useEffect } from "react";

// Returns a debounced copy of `value` that only updates after `delay` ms of no
// change. Use it to avoid firing a search request on every keystroke — vital
// when the search hits a table with hundreds of thousands of rows.
//
//   const debouncedSearch = useDebounce(search, 300);
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
