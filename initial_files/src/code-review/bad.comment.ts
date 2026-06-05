type User = {
  // 全部 optional / nullable になっている。
  // こうすると、どの値が本当に省略可能なのか分からない。
  id?: string | null;
  name?: string | null;
  age?: number | null;
  email?: string | null;
  role?: string | null;
};

type Item = {
  // price や count が本当に欠ける仕様なのか、
  // API が壊れているだけなのかが型から読めない。
  name?: string | null;
  price?: number | null;
  count?: number | null;
};

type ApiResult = {
  user?: User | null;
  items?: Item[] | null;

  // any を使った時点で、TypeScript の型安全性をかなり捨てている。
  config?: any;
};

function getUserLabel(data?: any): string {
  // any + 手動チェックの組み合わせ。
  // JS 時代の防御コードが TypeScript に残っている状態。
  if (!data) return "Unknown user";
  if (!data.user) return "Unknown user";

  // 変数名 u が雑。
  // 短すぎて、読み手が一瞬止まる。
  const u = data.user;

  // User 型では id は string | null | undefined のはずなのに、
  // typeof で再チェックしている。
  // 型定義を信用していない。
  const id =
    u.id !== undefined && u.id !== null && typeof u.id === "string"
      ? u.id
      : "unknown-id";

  // name がないときに "No Name" にしている。
  // 画面表示用ならまだあり得るが、ドメイン上の値として扱うなら危険。
  const name =
    u.name !== undefined && u.name !== null && typeof u.name === "string" && u.name.length > 0
      ? u.name
      : "No Name";

  // 年齢不明を 0 歳にしている。
  // これはかなり危険。
  // unknown と zero は意味が違う。
  const age =
    u.age !== undefined && u.age !== null && typeof u.age === "number"
      ? u.age
      : 0;

  // 存在しないメールアドレスを仮のメールに変えている。
  // 「メールがない」と「メールがある」を区別できなくなる。
  const email =
    u.email !== undefined &&
    u.email !== null &&
    typeof u.email === "string" &&
    u.email.length > 0
      ? u.email
      : "no-email@example.com";

  // ここまでで string にしているので、このチェックはほぼ意味がない。
  if (typeof id !== "string") return "Invalid user";
  if (typeof name !== "string") return "Invalid user";
  if (typeof email !== "string") return "Invalid user";

  // id を作っているのに使っていない。
  // 不要な変数は、設計の迷いを残す。
  return `${name} (${age}) <${email}>`;
}

function calculateTotal(data?: ApiResult | null): number {
  return (
    data?.items?.reduce((sum, item) => {
      // item が存在しない可能性を毎回考えている。
      // 本来は Item[] の配列なら item は存在する。
      const price =
        item &&
        item.price !== undefined &&
        item.price !== null &&
        typeof item.price === "number"
          ? item.price
          : 0;

      // count がないときに 1 とする仕様が関数内に埋まっている。
      // これが本当に正しい業務ルールなのか分からない。
      const count =
        item &&
        item.count !== undefined &&
        item.count !== null &&
        typeof item.count === "number"
          ? item.count
          : 1;

      return sum + price * count;
    }, 0) ?? 0
  );
}

function getDisplayTitle(data: any): string {
  // data, user, name のどこが壊れていても全部 "Untitled" になる。
  // 異常と正常な欠損が区別されない。
  if (!data) return "Untitled";
  if (!data.user) return "Untitled";
  if (!data.user.name) return "Untitled";

  return data.user.name;
}

function readPort(): number {
  // よくあるが雑な書き方。
  // PORT=0 も 3000 になる。
  // PORT=abc も 3000 になる。
  // 「未指定」と「不正な指定」を区別できない。
  const port = Number(process.env.PORT) || 3000;
  return port;
}

function isAdmin(user?: User | null): boolean {
  // role が必須なのか任意なのか分からないため、防御が増える。
  if (!user) return false;
  if (!user.role) return false;

  // if で true/false を返すだけなら、
  // return user.role === "admin" でよい。
  if (user.role === "admin") {
    return true;
  }

  return false;
}

function sendEmail(user?: User | null, message?: string | null): void {
  // メールがないユーザーに仮メールを入れて送信しようとしている。
  // 実際の送信処理なら事故になる。
  const email =
    user &&
    user.email &&
    typeof user.email === "string"
      ? user.email
      : "no-email@example.com";

  // 空文字の message も "No message" に変わる。
  // 空文字を許すのか、未指定だけを補うのかが曖昧。
  const body = message || "No message";

  console.log(`send to ${email}: ${body}`);
}

function renderUserCard(props?: any): string {
  // props が any なので、コンポーネントの入力仕様が読めない。
  const userName =
    props &&
    props.data &&
    props.data.user &&
    props.data.user.name &&
    typeof props.data.user.name === "string"
      ? props.data.user.name
      : "Guest";

  const total =
    props &&
    props.data &&
    props.data.items
      ? calculateTotal(props.data)
      : 0;

  const enabled =
    props && props.config && props.config.enabled !== undefined
      ? props.config.enabled
      : true;

  // render 系の関数なのに onClick を実行している。
  // 表示と副作用が混ざっている。
  if (props && props.onClick && typeof props.onClick === "function") {
    props.onClick();
  }

  if (!enabled) {
    return "disabled";
  }

  return `${userName}: ${total}`;
}

const result = {
  user: {
    id: "u_001",
    name: "Alice",
    age: null,
    email: null,
    role: "admin",
  },
  items: [
    { name: "Book", price: 1200, count: 2 },

    // price が null。
    // calculateTotal では 0 円扱いになるが、
    // それが正しいのか、データ異常なのか分からない。
    { name: "Pen", price: null, count: 3 },
  ],
};

console.log(getUserLabel(result));
console.log(calculateTotal(result));
console.log(getDisplayTitle(result));
console.log(readPort());
console.log(isAdmin(result.user));
sendEmail(result.user, "");
console.log(renderUserCard({ data: result, config: {}, onClick: () => console.log("clicked") }));