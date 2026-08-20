export interface GroupThreadRoute {
  projectId: string;
  groupId: string;
}

const NEW_THREAD_ROUTE_PREFIX = "new-thread";

export function groupThreadRoute({
  projectId,
  groupId,
}: GroupThreadRoute): string {
  return [
    NEW_THREAD_ROUTE_PREFIX,
    encodeURIComponent(projectId),
    encodeURIComponent(groupId),
  ].join("/");
}

export function parseGroupThreadRoute(
  subPath: string,
): GroupThreadRoute | null {
  const [prefix, encodedProjectId, encodedGroupId, ...rest] =
    subPath.split("/");
  if (
    prefix !== NEW_THREAD_ROUTE_PREFIX ||
    !encodedProjectId ||
    !encodedGroupId ||
    rest.length > 0
  ) {
    return null;
  }
  try {
    return {
      projectId: decodeURIComponent(encodedProjectId),
      groupId: decodeURIComponent(encodedGroupId),
    };
  } catch {
    return null;
  }
}
