export function describePurchaseRequestStatus(status) {
  if (status === "completed") return "Усе куплено";
  if (status === "partially_completed") return "Частково";
  if (status === "in_progress") return "У процесі";
  if (status === "cancelled") return "Скасовано";
  return "Відкрито";
}

export function describePurchaseItemStatus(status) {
  if (status === "bought") return "Куплено";
  if (status === "not_bought") return "Не куплено";
  return "Очікує";
}

export function getPurchaseRequestStatusClass(status) {
  if (status === "completed") return "resolved";
  if (status === "partially_completed") return "warning";
  if (status === "in_progress") return "active";
  if (status === "cancelled") return "muted";
  return "idle";
}

export function getPurchaseItemStatusClass(status) {
  if (status === "bought") return "resolved";
  if (status === "not_bought") return "warning";
  return "idle";
}

export function formatFamilyDateTime(value) {
  if (!value) return "щойно";

  try {
    return new Intl.DateTimeFormat("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
