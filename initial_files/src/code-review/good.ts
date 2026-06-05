type UserRole = "admin" | "member";

type User = {
  id: string;
  name: string;
  age: number | null;
  email: string | null;
  role: UserRole;
};

type Item = {
  name: string;
  price: number;
  quantity: number;
};

type AppConfig = {
  enabled: boolean;
};

type ApiResult = {
  user: User;
  items: Item[];
  config: AppConfig;
};

type UserCardProps = {
  data: ApiResult;
  onClick?: () => void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUserRole(value: unknown): UserRole | null {
  if (value === "admin" || value === "member") {
    return value;
  }

  return null;
}

function parseUser(value: unknown): User | null {
  if (!isObject(value)) return null;

  const role = parseUserRole(value.role);

  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    role === null
  ) {
    return null;
  }

  if (value.name.length === 0) {
    return null;
  }

  if (value.age !== null && typeof value.age !== "number") {
    return null;
  }

  if (value.email !== null && typeof value.email !== "string") {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    age: value.age,
    email: value.email,
    role,
  };
}

function parseItem(value: unknown): Item | null {
  if (!isObject(value)) return null;

  if (
    typeof value.name !== "string" ||
    typeof value.price !== "number" ||
    typeof value.quantity !== "number"
  ) {
    return null;
  }

  if (value.name.length === 0) {
    return null;
  }

  if (value.price < 0) {
    return null;
  }

  if (!Number.isInteger(value.quantity) || value.quantity < 1) {
    return null;
  }

  return {
    name: value.name,
    price: value.price,
    quantity: value.quantity,
  };
}

function parseConfig(value: unknown): AppConfig | null {
  if (!isObject(value)) return null;

  if (typeof value.enabled !== "boolean") {
    return null;
  }

  return {
    enabled: value.enabled,
  };
}

function parseApiResult(value: unknown): ApiResult | null {
  if (!isObject(value)) return null;

  const user = parseUser(value.user);
  if (user === null) return null;

  if (!Array.isArray(value.items)) {
    return null;
  }

  const items = value.items.map(parseItem);
  if (items.some((item) => item === null)) {
    return null;
  }

  const config = parseConfig(value.config);
  if (config === null) return null;

  return {
    user,
    items,
    config,
  };
}

function formatUserLabel(user: User): string {
  const ageLabel = user.age === null ? "age unknown" : String(user.age);
  const emailLabel = user.email === null ? "email unknown" : user.email;

  return `${user.name} (${ageLabel}) <${emailLabel}>`;
}

function calculateTotal(items: Item[]): number {
  return items.reduce((total, item) => {
    return total + item.price * item.quantity;
  }, 0);
}

function getDisplayTitle(user: User): string {
  return user.name;
}

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return 3000;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }

  return port;
}

function isAdmin(user: User): boolean {
  return user.role === "admin";
}

function createEmailMessage(user: User, message: string): string | null {
  if (user.email === null) {
    return null;
  }

  return `send to ${user.email}: ${message}`;
}

function renderUserCard(props: UserCardProps): string {
  if (!props.data.config.enabled) {
    return "disabled";
  }

  const userName = getDisplayTitle(props.data.user);
  const total = calculateTotal(props.data.items);

  return `${userName}: ${total}`;
}

function handleUserCardClick(props: UserCardProps): void {
  props.onClick?.();
}

const rawData: unknown = {
  user: {
    id: "u_001",
    name: "Alice",
    age: null,
    email: null,
    role: "admin",
  },
  items: [
    { name: "Book", price: 1200, quantity: 2 },
    { name: "Pen", price: 150, quantity: 3 },
  ],
  config: {
    enabled: true,
  },
};

const apiResult = parseApiResult(rawData);

if (apiResult === null) {
  throw new Error("Invalid API result");
}

const userCardProps: UserCardProps = {
  data: apiResult,
  onClick: () => console.log("clicked"),
};

console.log(formatUserLabel(apiResult.user));
console.log(calculateTotal(apiResult.items));
console.log(getDisplayTitle(apiResult.user));
console.log(readPort(process.env.PORT));
console.log(isAdmin(apiResult.user));

const emailMessage = createEmailMessage(apiResult.user, "");
if (emailMessage !== null) {
  console.log(emailMessage);
}

console.log(renderUserCard(userCardProps));
handleUserCardClick(userCardProps);