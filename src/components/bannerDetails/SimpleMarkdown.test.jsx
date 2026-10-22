import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SimpleMarkdown from "./SimpleMarkdown";

describe("SimpleMarkdown", () => {
  it("renders bold, italics, links, lists and line breaks without raw HTML", () => {
    const { container } = render(
      <SimpleMarkdown
        text={"**Bold** and *it* <script>x</script>\nsee https://example.com/a.\n\n- one\n- [two](https://x.org)"}
      />
    );
    expect(container.querySelector("strong").textContent).toBe("Bold");
    expect(container.querySelector("em").textContent).toBe("it");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>x</script>");
    expect(container.querySelector("br")).not.toBeNull();
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["https://example.com/a", "https://x.org"]);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("never links javascript: urls", () => {
    const { container } = render(<SimpleMarkdown text={"[x](javascript:alert(1))"} />);
    expect(container.querySelector("a")).toBeNull();
  });
});
