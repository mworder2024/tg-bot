import { getRedisClient } from './redis-client';

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
  private config: ConfigData = { admins: [], groups: {} };
  private readonly REDIS_KEY_ADMINS = 'bot:config:admins';
  private readonly REDIS_KEY_GROUPS = 'bot:config:groups';

  constructor() {
    this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      const redisClient = getRedisClient();
      if (redisClient) {
        // Load admins from Redis
        const adminsData = await redisClient.get(this.REDIS_KEY_ADMINS);
        if (adminsData) {
          this.config.admins = JSON.parse(adminsData);
        }

        // Load groups from Redis
        const groupsData = await redisClient.get(this.REDIS_KEY_GROUPS);
        if (groupsData) {
          const parsedGroups = JSON.parse(groupsData);
          // Convert date strings back to Date objects
          for (const groupId in parsedGroups) {
            parsedGroups[groupId].addedAt = new Date(parsedGroups[groupId].addedAt);
          }
          this.config.groups = parsedGroups;
        }
      }
    } catch (error) {
      console.error('Error loading config from Redis:', error);
      this.config = { admins: [], groups: {} };
    }
  }

  private async saveConfig(): Promise<void> {
    try {
      const redisClient = getRedisClient();
      if (redisClient) {
        // Save admins to Redis
        await redisClient.set(this.REDIS_KEY_ADMINS, JSON.stringify(this.config.admins));
        
        // Save groups to Redis
        await redisClient.set(this.REDIS_KEY_GROUPS, JSON.stringify(this.config.groups));
      }
    } catch (error) {
      console.error('Error saving config to Redis:', error);
    }
  }

  // Admin management
  async addAdmin(userId: string): Promise<boolean> {
    await this.loadConfig(); // Ensure we have latest data
    if (!this.config.admins.includes(userId)) {
      this.config.admins.push(userId);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  async removeAdmin(userId: string): Promise<boolean> {
    await this.loadConfig();
    const index = this.config.admins.indexOf(userId);
    if (index > -1) {
      this.config.admins.splice(index, 1);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  async isAdmin(userId: string): Promise<boolean> {
    await this.loadConfig();
    return this.config.admins.includes(userId);
  }

  async getAdmins(): Promise<string[]> {
    await this.loadConfig();
    return [...this.config.admins];
  }

  // Group management
  async addGroup(groupId: string, groupName: string, addedBy: string): Promise<boolean> {
    await this.loadConfig();
    if (!this.config.groups[groupId]) {
      this.config.groups[groupId] = {
        id: groupId,
        name: groupName,
        addedBy,
        addedAt: new Date(),
        enabled: true
      };
      await this.saveConfig();
      return true;
    }
    return false;
  }

  async removeGroup(groupId: string): Promise<boolean> {
    await this.loadConfig();
    if (this.config.groups[groupId]) {
      delete this.config.groups[groupId];
      await this.saveConfig();
      return true;
    }
    return false;
  }

  async enableGroup(groupId: string): Promise<boolean> {
    await this.loadConfig();
    if (this.config.groups[groupId]) {
      this.config.groups[groupId].enabled = true;
      await this.saveConfig();
      return true;
    }
    return false;
  }

  async disableGroup(groupId: string): Promise<boolean> {
    await this.loadConfig();
    if (this.config.groups[groupId]) {
      this.config.groups[groupId].enabled = false;
      await this.saveConfig();
      return true;
    }
    return false;
  }

  async isGroupEnabled(groupId: string): Promise<boolean> {
    await this.loadConfig();
    const group = this.config.groups[groupId];
    return group ? group.enabled : false;
  }

  async getGroups(): Promise<GroupConfig[]> {
    await this.loadConfig();
    return Object.values(this.config.groups);
  }

  async getEnabledGroups(): Promise<GroupConfig[]> {
    await this.loadConfig();
    return Object.values(this.config.groups).filter(group => group.enabled);
  }

  async getGroup(groupId: string): Promise<GroupConfig | null> {
    await this.loadConfig();
    return this.config.groups[groupId] || null;
  }

  async toggleEnabledGroup(groupId: string): Promise<boolean> {
    await this.loadConfig();
    if (this.config.groups[groupId]) {
      this.config.groups[groupId].enabled = !this.config.groups[groupId].enabled;
      await this.saveConfig();
      return true;
    }
    return false;
  }

  // Alias for toggleEnabledGroup for backward compatibility
  async toggleGroup(groupId: string): Promise<boolean> {
    return this.toggleEnabledGroup(groupId);
  }

  // Initialize with default admin and current group from .env
  async initialize(defaultAdminId?: string, defaultGroupId?: string, defaultGroupName?: string): Promise<void> {
    // Add default admin if provided and not already added
    if (defaultAdminId && !(await this.isAdmin(defaultAdminId))) {
      await this.addAdmin(defaultAdminId);
    }

    // Add default group if provided and not already added
    if (defaultGroupId && defaultGroupName && !(await this.getGroup(defaultGroupId))) {
      await this.addGroup(defaultGroupId, defaultGroupName, defaultAdminId || 'system');
    }
  }

  // Synchronous methods for backward compatibility (these will load from cache)
  isAdminSync(userId: string): boolean {
    return this.config.admins.includes(userId);
  }

  isGroupEnabledSync(groupId: string): boolean {
    const group = this.config.groups[groupId];
    return group ? group.enabled : false;
  }

  getGroupSync(groupId: string): GroupConfig | null {
    return this.config.groups[groupId] || null;
  }

  getAdminsSync(): string[] {
    return [...this.config.admins];
  }

  getGroupsSync(): GroupConfig[] {
    return Object.values(this.config.groups);
  }

  getEnabledGroupsSync(): GroupConfig[] {
    return Object.values(this.config.groups).filter(group => group.enabled);
  }
}

export const groupManager = new GroupManager();
export { GroupConfig };