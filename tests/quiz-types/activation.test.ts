import { describe, expect, it, vi } from "vitest";
import { blurPointerActivatedButton } from "../../src/quiz/types/activation";

describe("blurPointerActivatedButton", () => {
  it("指针点击触发的 click 会释放按钮焦点", () => {
    const button = document.createElement("button");
    const blur = vi.spyOn(button, "blur");

    button.addEventListener("click", blurPointerActivatedButton);
    button.dispatchEvent(new MouseEvent("click", { detail: 1 }));

    expect(blur).toHaveBeenCalledOnce();
  });

  it("键盘触发的 click 保留按钮焦点", () => {
    const button = document.createElement("button");
    const blur = vi.spyOn(button, "blur");

    button.addEventListener("click", blurPointerActivatedButton);
    button.dispatchEvent(new MouseEvent("click", { detail: 0 }));

    expect(blur).not.toHaveBeenCalled();
  });
});
