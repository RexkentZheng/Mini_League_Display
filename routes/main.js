import fetch from 'node-fetch'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
import got from 'got'
import {
  PrismaClient
} from '@prisma/client';
import {
  join
} from 'path';
import fs from 'fs';
import crypto from "crypto";
import sharp from 'sharp';

const prisma = new PrismaClient();
export const imageDirectory = join(__dirname, "../wallpapers")

export default class LeagueService {

  async getVersion() {
    const res = await got('https://ddragon.leagueoflegends.com/api/versions.json').json()
    return res[0]
  }

  async getChampions() {
    const champions = []
    const lastVersion = await this.getVersion()
    const {
      data
    } = await got(`http://ddragon.leagueoflegends.com/cdn/${lastVersion}/data/en_US/champion.json`).json()
    Object.values(data).forEach((champion, index) => champions[index] = this.updateChampion(lastVersion, champion))
    await Promise.all(champions);
    await this.downloadWallpapers()
    return data
  }

  async getFailedSkin() {
    const res = await prisma.skin.findMany({
      where: {
        failed: 2
      }
    })
    return res
  }

  async getFailedSkinItem(id) {
    const skin = await prisma.skin.findUnique({
      where: {
        id
      },
      include: {
        champion: true
      }
    })
    const urls = await this.generatorUrls(id)
    console.log('------urls------', urls)
    await this.beforeDownloadImage(JSON.parse(JSON.stringify(urls)))
    return {
      skin,
      urls
    }
  }

  async generatorUrls(id) {
    const skin = await prisma.skin.findUnique({
      where: {
        id
      },
      include: {
        champion: true
      }
    })
    const imageName = await this.getImageName(id)
    const url = await this.generatorImageUrl(imageName)
    const newImageNameArr = imageName.split('_')
    const newImageName = newImageNameArr[newImageNameArr.length - 1]
    const newUrl = this.generatorImageUrl(newImageName)
    // @ts-ignore
    const new2ImageName = [skin.championId, imageName.split('_').join('')].join('_')
    const new2Url = this.generatorImageUrl(new2ImageName)
    return [{
      id,
      url,
      name: imageName
    }, {
      id,
      url: newUrl,
      name: newImageName
    }, {
      id,
      url: new2Url,
      name: new2ImageName
    }]
  }

  async giveUpSkin(id) {
    const res = await prisma.skin.update({
      where: {
        id
      },
      data: {
        failed: 3
      }
    })
    return res
  }

  async beforeDownloadImage(urls, index, total) {
    // @ts-ignore
    const fetchUrl = async (urls, skinId) => {
      if (!urls.length) {
        console.log('------确实找不到------')
        prisma.skin.update({
          where: {
            id: skinId
          },
          data: {
            failed: 2
          }
        })
        return Promise.resolve()
      }
      const {
        url,
        name,
        id
      } = urls.shift()
      if (!fs.existsSync(`${imageDirectory}/${name}.jpg`)) {
        const res = await fetch(url)
        if (res.status !== 200) {
          console.log('------没这张图------，换个名字再试试', url)
          return fetchUrl(urls, id)
        }
        console.log('------下载成功------', name)
        if (index && total) {
          console.log('------进度------', `${((index + 1) / total * 100).toFixed(2)}%`, `${index}/${total}`)
        }
        await prisma.skin.update({
          where: {
            id
          },
          data: {
            failed: 1
          }
        })
        const highResJpgImage = sharp(await res.buffer()).jpeg({
          quality: 100
        });
        return await this.saveImage(highResJpgImage, `${imageDirectory}/${name}.jpg`);
      } else {
        console.log('------找到了！------', name, id)
        await prisma.skin.update({
          where: {
            id
          },
          data: {
            failed: 1
          }
        })
        return Promise.resolve()
      }

    }
    return fetchUrl(urls)
  }

  async updateChampion(version, champion) {
    const championId = champion.id;
    champion = await got(`http://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion/${championId}.json`).json();
    champion = champion.data[championId]

    if (!await prisma.champion.findUnique({
        where: {
          id: championId
        }
      })) {
      await prisma.champion.create({
        data: {
          id: championId,
          name: champion.name,
          title: champion.title,
          lore: champion.lore
        }
      });
    }
    let storedSkins = await prisma.skin.findMany({
      select: {
        number: true
      },
      where: {
        championId: champion.id
      }
    });
    storedSkins = storedSkins.map((skin) => skin.number);
    const skins = champion.skins.filter((skin) => !storedSkins.includes(skin.num));

    for (let i = 0; i < skins.length; i++) skins[i] = this.updateSkin(champion, skins[i]);
    await Promise.all(skins);
  }

  async updateSkin(champion, skin) {
    skin.name = skin.name == "default" ? `Original ${champion.name}` : skin.name;
    skin = {
      id: +skin.id,
      number: skin.num,
      name: skin.name,
      championId: champion.id,
      failed: 1
    };
    skin = await prisma.skin.upsert({
      where: {
        id: skin.id
      },
      create: skin,
      update: skin
    });
   console.log(`------更新${champion.name}skin成功------`)
    return skin;
  }

  async saveImage(image, filePath) {
    const directoryName = dirname(filePath);
    if (!fs.existsSync(directoryName)) fs.mkdirSync(directoryName, {
      recursive: true
    });
    await image.pipe(fs.createWriteStream(filePath));
    await this.waiting()
  }

  waiting() {
    return new Promise((resolve) => {
      setTimeout(() => {
       console.log('------waiting------')
        resolve(true)
      }, 10)
    })
  }

  async getImageName(skinId) {
    const skin = await prisma.skin.findUnique({
      where: {
        id: skinId
      },
      include: {
        champion: true
      }
    });
    // @ts-ignore
    skin.name = skin.name.replace(skin.champion.name, "").replace("/", "").replace(":", "").replace(/\s/g, "");
    // @ts-ignore
    return `${skin.champion.name.replace(" ", "_")}_${skin.name}`
  }

  generatorImageUrl(imageName) {
    const fileName = `${imageName}Skin_HD.jpg`;
    const fileNameMD5 = crypto.createHash("md5").update(fileName).digest("hex");
    return `https://static.wikia.nocookie.net/leagueoflegends/images/${fileNameMD5[0]}/${fileNameMD5.substring(0, 2)}/${fileName}/revision/latest?cb=12`;
  }

  // @ts-ignore
  async downloadAndSetWallpaper(skinId, index, total) {
    const imageName = await this.getImageName(skinId)
    const skin = await prisma.skin.findUnique({
      where: {
        id: skinId,
      }
    })
    if (!fs.existsSync(`${imageDirectory}/${imageName}.jpg`)) {
     console.log('------准备下载------', imageName)
      const urls = await this.generatorUrls(skinId)
      return await this.beforeDownloadImage(urls, index, total)
    } else {
     console.log('------图片已下载------')
     console.log('------进度------', `${((index + 1) / total * 100).toFixed(2)}%`, `${index}/${total}`)
      return Promise.resolve()
    }
  }

  async downloadWallpapers() {
    const skins = await prisma.skin.findMany();
    let count = 0
    const max = 10
    const arr= []
    const handler = (fn) => {
      if (count === max - 1) {
        arr.push(fn)
      } else {
        count++
        fn().then(() => {
          count--
          arr.length && handler(arr.shift())
        })
      }
    }
    for (let i = 0; i < skins.length; i++) {
      handler(() => this.downloadAndSetWallpaper(skins[i].id, i, skins.length))
    }
  }
}