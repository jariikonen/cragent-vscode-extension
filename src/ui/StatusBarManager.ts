export interface StatusBarItem {
  text: string;
  tooltip: string | { value: string } | undefined;
  show(): void;
  dispose(): void;
}

export class StatusBarManager {
  private item: StatusBarItem;

  constructor(item: StatusBarItem) {
    this.item = item;
    this.item.show();
  }

  setConnected(serverUrl: string): void {
    this.item.text = '$(check) Code Review: Connected';
    this.item.tooltip = serverUrl;
  }

  setDisconnected(): void {
    this.item.text = '$(x) Code Review: Disconnected';
    this.item.tooltip = undefined;
  }

  setReviewing(): void {
    this.item.text = '$(sync~spin) Code Review: Reviewing…';
  }

  dispose(): void {
    this.item.dispose();
  }
}
