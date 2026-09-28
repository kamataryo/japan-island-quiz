/**
 * 結果画面に出す「ホーム画面に追加」の案内。
 * Android の Chrome などは beforeinstallprompt を受け取れたら、その場で追加の画面を出すボタンにする。
 * iOS には追加を呼び出す API がないので、共有メニューからの手順を文字で示す。
 * 結果画面の一番下で邪魔にならないので、閉じるボタンは付けず、追加済みと分からない限り毎回出す
 * （iOS は追加済みかどうかをページから知る方法がないので、追加した人にも Safari では出続ける）
 */

type InstallPrompt = Event & { prompt(): Promise<unknown> };
let deferred: InstallPrompt | undefined;
let installed = false;

addEventListener("beforeinstallprompt", (e) => {
  // ブラウザが自前で出すバーを止め、結果画面のボタンから出す
  e.preventDefault();
  deferred = e as InstallPrompt;
});
addEventListener("appinstalled", () => {
  installed = true;
  document.querySelector(".install-hint")?.remove();
});
// Android の Chrome は、manifest の related_applications に自分を書いておくと追加済みかを確かめられる
(
  navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<unknown[]>;
  }
)
  .getInstalledRelatedApps?.()
  .then((apps) => {
    if (apps.length) installed = true;
  })
  .catch(() => {});

const ua = navigator.userAgent;
// iPadOS の Safari は Mac と同じ UA を名乗るので、タッチの有無で見分ける
const ios =
  /iPhone|iPad|iPod/.test(ua) ||
  (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const android = /Android/.test(ua);
const standalone =
  matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** 案内を出す条件を満たすときだけ、parent の末尾に案内を足す */
export function appendInstallHint(parent: HTMLElement) {
  if (standalone || installed || !(ios || android)) return;
  const hint = document.createElement("aside");
  hint.className = "install-hint";
  hint.setAttribute("aria-label", "ホーム画面に追加");
  const how = deferred
    ? `<button class="btn retro" type="button" data-install>ホーム画面に追加する</button>`
    : ios
      ? `<p>ブラウザの共有ボタン（四角に上向きの矢印）から「ホーム画面に追加」を選んでください。</p>`
      : `<p>ブラウザのメニュー（⋮）から「ホーム画面に追加」または「アプリをインストール」を選んでください。</p>`;
  hint.innerHTML = `
    <p class="install-hint__lead">ホーム画面に追加すると、いつでもすぐに遊べます。</p>
    ${how}`;
  const button = hint.querySelector<HTMLButtonElement>("[data-install]");
  button?.addEventListener("click", async () => {
    const p = deferred;
    deferred = undefined; // prompt() は1回しか呼べない
    await p?.prompt();
    // 追加しなかったときはボタンだけ消す。次の結果画面ではメニューからの手順を出す
    button.remove();
  });
  parent.append(hint);
}
