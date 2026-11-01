// 앱 안에 직접 그리는 확인·알림 창.
// allow-modals가 없는 iframe(아이쌤지피티 등)에서는 confirm·alert가 뜨지 않고 confirm은 항상 false가 되므로 이것을 쓴다.
// body에 바로 붙이기 때문에 화면이 이동해도 창이 남고, 창이 떠 있는 동안 뒤의 화면은 잠근다.

type DialogJob = {
  message: string;
  cancelable: boolean;
  resolve: (ok: boolean) => void;
};

const queue: DialogJob[] = [];
let showing = false;

const baseButton =
  'padding:10px 22px;border:4px solid #000;border-radius:12px;font:inherit;font-size:15px;font-weight:900;cursor:pointer;box-shadow:3px 3px 0 #000;';

function createButton(label: string, style: string, onClick: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.cssText = baseButton + style;
  button.addEventListener('click', onClick);
  return button;
}

function showNext() {
  const job = queue.shift();
  if (!job) {
    showing = false;
    return;
  }
  showing = true;

  const previousFocus = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55);';

  const box = document.createElement('div');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  box.style.cssText =
    'width:100%;max-width:440px;box-sizing:border-box;padding:24px;background:#fff;color:#0f172a;border:4px solid #000;border-radius:20px;box-shadow:6px 6px 0 #000;';

  const text = document.createElement('p');
  text.textContent = job.message;
  text.style.cssText =
    'margin:0 0 20px;font-size:16px;font-weight:800;line-height:1.6;white-space:pre-wrap;word-break:keep-all;';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';

  // 뒤의 화면을 잠가, 게임 입력칸이 포커스를 도로 가져가는 것을 막는다.
  const locked = Array.from(document.body.children).filter((el) => !el.hasAttribute('inert'));

  const close = (ok: boolean) => {
    window.removeEventListener('keydown', onKeyDown, true);
    locked.forEach((el) => el.removeAttribute('inert'));
    overlay.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
    job.resolve(ok);
    showNext();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // 창 밖의 게임 단축키로 키 입력이 새지 않게 한다.
    e.stopPropagation();
    if (isReloadKey(e)) {
      e.preventDefault();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const buttons = Array.from(actions.querySelectorAll('button'));
      const next = (buttons.indexOf(document.activeElement as HTMLButtonElement) + 1) % buttons.length;
      buttons[next].focus();
    } else if (e.repeat) {
      // 타자 치던 키가 눌린 채로 창이 닫히지 않게 한다.
      e.preventDefault();
    }
  };

  const okButton = createButton('확인', 'background:#f43f5e;color:#fff;', () => close(true));
  if (job.cancelable) {
    actions.appendChild(createButton('취소', 'background:#fff;color:#0f172a;', () => close(false)));
  }
  actions.appendChild(okButton);

  box.append(text, actions);
  overlay.appendChild(box);
  locked.forEach((el) => el.setAttribute('inert', ''));
  document.body.appendChild(overlay);
  window.addEventListener('keydown', onKeyDown, true);
  okButton.focus();
}

function enqueue(message: string, cancelable: boolean) {
  return new Promise<boolean>((resolve) => {
    queue.push({ message, cancelable, resolve });
    if (!showing) showNext();
  });
}

// 한글 입력 상태에서는 e.key가 'ㄱ'이 되므로 물리 키(e.code)로 확인한다.
export function isReloadKey(e: KeyboardEvent) {
  return e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.code === 'KeyR');
}

// allow-modals가 없는 iframe에서는 새로고침 경고(beforeunload)가 뜨지 않으므로 키 입력만이라도 막는다.
// 브라우저의 새로고침 버튼은 막을 수 없다. 반환값을 호출하면 차단이 풀린다.
export function blockReloadKeys(message: string) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isReloadKey(e) || e.defaultPrevented) return;
    e.preventDefault();
    if (!e.repeat) appAlert(message);
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

// confirm 대신 사용: 확인을 누르면 true, 취소하면 false
export function appConfirm(message: string) {
  return enqueue(message, true);
}

// alert 대신 사용: 기다릴 필요가 없으면 await 없이 호출해도 된다.
export function appAlert(message: string) {
  void enqueue(message, false);
}
