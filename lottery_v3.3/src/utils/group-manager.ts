import * as fs from 'fs';
import * as path from 'path';

interface GroupConfig {
  id: string;
  name: string;
  addedBy: string;
  addedAt: Date;
  enabled: boolean;
}

interface ConfigData {
  admins: string[];
  groups: { [key: string]: GroupConfig };
}

class GroupManager {
  private configPath: string;
  private config: ConfigData = { admins: [], groups: {} };

  constructor() {
    this.configPath = path.join(__dirname, '../config/groups.json');
    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        this.config = JSON.parse(data);
      } else {
        this.config = { admins: [], groups: {} };
        this.saveConfig();
      }
    } catch (error) {
      console.error('Error loading group config:', error);
      this.config = { admins: [], groups: {} };
    }
  }

  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Error saving group config:', error);
    }
  }

  // Admin management
  addAdmin(userId: string): boolean {
    if (!this.config.admins.includes(userId)) {
      this.config.admins.push(userId);
      this.saveConfig();
      return true;
    }
    return false;
  }

  removeAdmin(userId: string): boolean {
    const index = this.config.admins.indexOf(userId);
    if (index > -1) {
      this.config.admins.splice(index, 1);
      this.saveConfig();
      return true;
    }
    return false;
  }

  isAdmin(userId: string): boolean {
    return this.config.admins.includes(userId);
  }

  getAdmins(): string[] {
    return [...this.config.admins];
  }

  // Group management
  addGroup(groupId: string, groupName: string, addedBy: string): boolean {
    if (!this.config.groups[groupId]) {
      this.config.groups[groupId] = {
        id: groupId,
        name: groupName,
        addedBy,
        addedAt: new Date(),
        enabled: true
      };
      this.saveConfig();
      return true;
    }
    return false;
  }

  removeGroup(groupId: string): boolean {
    if (this.config.groups[groupId]) {
      delete this.config.groups[groupId];
      this.saveConfig();
      return true;
    }
    return false;
  }

  enableGroup(groupId: string): boolean {
    if (this.config.groups[groupId]) {
      this.config.groups[groupId].enabled = true;
      this.saveConfig();
      return true;
    }
    return false;
  }

  disableGroup(groupId: string): boolean {
    if (this.config.groups[groupId]) {
      this.config.groups[groupId].enabled = false;
      this.saveConfig();
      return true;
    }
    return false;
  }

  isGroupEnabled(groupId: string): boolean {
    const group = this.config.groups[groupId];
    return group ? group.enabled : false;
  }

  getGroups(): GroupConfig[] {
    return Object.values(this.config.groups);
  }

  getEnabledGroups(): GroupConfig[] {
    return Object.values(this.config.groups).filter(group => group.enabled);
  }

  getGroup(groupId: string): GroupConfig | null {
    return this.config.groups[groupId] || null;
  }

  // Initialize with default admin and current group from .env
  initialize(defaultAdminId?: string, defaultGroupId?: string, defaultGroupName?: string): void {
    // Add default admin if provided and not already added
    if (defaultAdminId && !this.isAdmin(defaultAdminId)) {
      this.addAdmin(defaultAdminId);
    }

    // Add default group if provided and not already added
    if (defaultGroupId && defaultGroupName && !this.getGroup(defaultGroupId)) {
      this.addGroup(defaultGroupId, defaultGroupName, defaultAdminId || 'system');
    }
  }
}

export const groupManager = new GroupManager();
export { GroupConfig };