type User = {
  id?: string | null;
  name?: string | null;
  age?: number | null;
  email?: string | null;
  role?: string | null;
};

type Item = {
  name?: string | null;
  price?: number | null;
  count?: number | null;
};

type ApiResult = {
  user?: User | null;
  items?: Item[] | null;
  config?: any;
};

function getUserLabel(data?: any): string {
  if (!data) return "Unknown user";
  if (!data.user) return "Unknown user";

  const u = data.user;

  const id =
    u.id !== undefined && u.id !== null && typeof u.id === "string"
      ? u.id
      : "unknown-id";

  const name =
    u.name !== undefined && u.name !== null && typeof u.name === "string" && u.name.length > 0
      ? u.name
      : "No Name";

  const age =
    u.age !== undefined && u.age !== null && typeof u.age === "number"
      ? u.age
      : 0;

  const email =
    u.email !== undefined &&
    u.email !== null &&
    typeof u.email === "string" &&
    u.email.length > 0
      ? u.email
      : "no-email@example.com";

  if (typeof id !== "string") return "Invalid user";
  if (typeof name !== "string") return "Invalid user";
  if (typeof email !== "string") return "Invalid user";

  return `${name} (${age}) <${email}>`;
}

function calculateTotal(data?: ApiResult | null): number {
  return (
    data?.items?.reduce((sum, item) => {
      const price =
        item &&
        item.price !== undefined &&
        item.price !== null &&
        typeof item.price === "number"
          ? item.price
          : 0;

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
  if (!data) return "Untitled";
  if (!data.user) return "Untitled";
  if (!data.user.name) return "Untitled";

  return data.user.name;
}

function readPort(): number {
  const port = Number(process.env.PORT) || 3000;
  return port;
}

function isAdmin(user?: User | null): boolean {
  if (!user) return false;
  if (!user.role) return false;

  if (user.role === "admin") {
    return true;
  }

  return false;
}

function sendEmail(user?: User | null, message?: string | null): void {
  const email =
    user &&
    user.email &&
    typeof user.email === "string"
      ? user.email
      : "no-email@example.com";

  const body = message || "No message";

  console.log(`send to ${email}: ${body}`);
}

function renderUserCard(props?: any): string {
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