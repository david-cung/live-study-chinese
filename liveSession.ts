// Session benefits survive transport reconnects, including an explicit
// disconnect/reconnect to the same room. A new room/account starts fresh.
export class LiveSession {
  readonly named = new Set<string>();
  readonly followed = new Set<string>();
  private username = '';
  private roomId = '';
  totalLikes = 0;

  enter(username: string, roomId: string) {
    const changed = username !== this.username || (!!roomId && !!this.roomId && roomId !== this.roomId);
    if (changed) {
      this.named.clear();
      this.followed.clear();
      this.totalLikes = 0;
      this.roomId = '';
    }
    this.username = username;
    if (roomId) this.roomId = roomId;
    return changed;
  }
}
