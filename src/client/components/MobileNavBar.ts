import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("mobile-nav-bar")
export class MobileNavBar extends LitElement {
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);
    const current = window.currentPageId;
    if (current) {
      this.updateComplete.then(() => this._updateActiveState(current));
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("showPage", this._onShowPage);
  }

  private _onShowPage = (e: Event) => {
    this._updateActiveState((e as CustomEvent).detail);
  };

  private _updateActiveState(pageId: string) {
    this.querySelectorAll(".nav-menu-item").forEach((el) => {
      if ((el as HTMLElement).dataset.page === pageId) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    });
  }

  render() {
    window.currentPageId ??= "page-play";
    const currentPage = window.currentPageId;

    return html`
      <div
        class="flex-1 w-full flex flex-col justify-start overflow-y-auto pt-4 pb-4 px-5 gap-4"
      >
        <button
          class="nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 ${currentPage ===
          "page-play"
            ? "active"
            : ""}"
          data-page="page-play"
          data-i18n="main.play"
        ></button>
        <button
          class="nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 ${currentPage ===
          "page-settings"
            ? "active"
            : ""}"
          data-page="page-settings"
          data-i18n="main.settings"
        ></button>
      </div>
    `;
  }
}
