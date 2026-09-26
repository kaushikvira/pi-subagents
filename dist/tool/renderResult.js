import { renderTaskResultBody, } from "./renderTaskResultBody.js";
export function renderResult(result, options, theme, _context) {
    const details = (result.details ?? {});
    const firstContent = result.content?.[0];
    const fullText = firstContent && "text" in firstContent
        ? (firstContent.text ?? "").trim()
        : "";
    return renderTaskResultBody(details, fullText, options, theme);
}
