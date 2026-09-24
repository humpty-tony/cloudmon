export const TEXT_PAGE_SIZE = 32768;

/** Stable boundaries keep both halves of a surrogate pair in the same segment. */
export function textPage(text: string, page: number): string {
  const boundary = (index: number) => {
    const before=text.charCodeAt(index-1),after=text.charCodeAt(index);
    return before>=0xd800 && before<=0xdbff && after>=0xdc00 && after<=0xdfff ? index+1 : index;
  };
  return text.slice(boundary(page*TEXT_PAGE_SIZE),boundary((page+1)*TEXT_PAGE_SIZE));
}
