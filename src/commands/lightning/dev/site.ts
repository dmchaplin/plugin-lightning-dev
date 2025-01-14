/*
 * Copyright (c) 2023, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import fs from 'node:fs';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { expDev, setupDev } from '@lwrjs/api';
import { OrgUtils } from '../../../shared/orgUtils.js';
import { PromptUtils } from '../../../shared/promptUtils.js';
import { ExperienceSite } from '../../../shared/experience/expSite.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-lightning-dev', 'lightning.dev.site');
const sharedMessages = Messages.loadMessages('@salesforce/plugin-lightning-dev', 'shared.utils');

export default class LightningDevSite extends SfCommand<void> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly enableJsonFlag = false; // Disable json flag since we don't return anything

  public static readonly flags = {
    name: Flags.string({
      summary: messages.getMessage('flags.name.summary'),
      char: 'n',
    }),
    'target-org': Flags.requiredOrg(),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(LightningDevSite);

    try {
      const org = flags['target-org'];
      let siteName = flags.name;

      const connection = org.getConnection(undefined);

      const localDevEnabled = await OrgUtils.isLocalDevEnabled(connection);
      if (!localDevEnabled) {
        throw new Error(sharedMessages.getMessage('error.localdev.not.enabled'));
      }

      OrgUtils.ensureMatchingAPIVersion(connection);

      // If user doesn't specify a site, prompt the user for one
      if (!siteName) {
        const allSites = await ExperienceSite.getAllExpSites(org);
        siteName = await PromptUtils.promptUserToSelectSite(allSites);
      }

      const selectedSite = new ExperienceSite(org, siteName);
      let siteZip: string | undefined;

      if (!selectedSite.isSiteSetup()) {
        this.log(`[local-dev] initializing: ${siteName}`);
        siteZip = await selectedSite.downloadSite();
      } else {
        // If local-dev is already setup, check if an updated site has been published to download
        const updateAvailable = await selectedSite.isUpdateAvailable();
        if (updateAvailable) {
          const shouldUpdate = await PromptUtils.promptUserToConfirmUpdate(siteName);
          if (shouldUpdate) {
            this.log(`[local-dev] updating: ${siteName}`);
            siteZip = await selectedSite.downloadSite();
            // delete oldSitePath recursive
            const oldSitePath = selectedSite.getExtractDirectory();
            if (fs.existsSync(oldSitePath)) {
              fs.rmdirSync(oldSitePath, { recursive: true });
            }
          }
        }
      }

      // Establish a valid access token for this site
      const authToken = await selectedSite.setupAuth();

      // Start the dev server
      const port = parseInt(process.env.PORT ?? '3000', 10);
      const startupParams = {
        sfCli: true,
        authToken,
        open: true,
        port,
        logLevel: 'error',
        mode: 'dev',
        siteZip,
        siteDir: selectedSite.getSiteDirectory(),
      };

      // Environment variable used to setup the site rather than setup & start server
      if (process.env.SETUP_ONLY === 'true') {
        await setupDev(startupParams);
      } else {
        await expDev(startupParams);
      }
    } catch (e) {
      this.log('Local Development setup failed', e);
    }
  }
}
